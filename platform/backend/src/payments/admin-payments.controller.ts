import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentOrder } from './payment-order.entity';
import { Tenant } from '../tenants/tenant.entity';
import { AuditService } from '../audit/audit.service';
import { Notification } from '../notifications/notification.entity';
import { localDateISO } from '../common/date.util';
import { applyPaidOrder } from '../plans/subscription';

/** 平台侧支付核销（对公转账待核销 → 确认到账 → 套餐生效） */
@Controller('api/v1/admin/payments')
export class AdminPaymentsController {
  constructor(
    @InjectRepository(PaymentOrder) private readonly orders: Repository<PaymentOrder>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly audit: AuditService,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
  ) {}

  /** 支付订单列表（平台视角：可筛选待核销） */
  @Get()
  async list(@Query('status') status?: string) {
    const where: Record<string, unknown> = {};
    if (status && ['PENDING', 'PENDING_VERIFICATION', 'PAID', 'CANCELLED'].includes(status)) where.status = status;
    const orders = await this.orders.find({ where, order: { createdAt: 'DESC' }, take: 100 });
    const tMap: Record<string, string> = {};
    for (const t of await this.tenants.find()) tMap[t.id] = t.name;
    return { code: 0, message: 'success', data: orders.map((o) => ({ ...o, tenantName: tMap[o.tenantId] ?? o.tenantId.slice(0, 8) })) };
  }

  /** 核销对公转账（确认到账 → PAID → 套餐生效 + 通知租户） */
  @Post(':id/verify')
  async verify(@Param('id') id: string, @Body() body: { note?: string }) {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new HttpException({ code: 40401, message: '订单不存在', data: null }, HttpStatus.NOT_FOUND);
    if (order.payType !== 'BANK_TRANSFER' || order.status !== 'PENDING_VERIFICATION') {
      throw new HttpException({ code: 42201, message: `订单状态不可核销（${order.status}）`, data: null }, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    await this.orders.manager.transaction(async manager => {
      const locked = await manager.findOne(PaymentOrder, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!locked || locked.status !== 'PENDING_VERIFICATION') throw new HttpException('订单已处理，请刷新', 409);
      const tenant = await manager.findOne(Tenant, { where: { id: order.tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!tenant) throw new HttpException('租户不存在', 404);
      applyPaidOrder(tenant, locked); locked.status = 'PAID'; locked.paidAt = new Date();
      if (body?.note) locked.remark = `平台核销：${body.note}`;
      await manager.save(tenant); await manager.save(locked); Object.assign(order, locked);
    });
    await this.audit.log({ tenantId: order.tenantId, question: '[支付] 对公转账核销', result: `按订单安排套餐：${order.planName}` }).catch(() => undefined);
    // 通知租户
    await this.notifications.save(this.notifications.create({
      tenantId: order.tenantId,
      type: 'payment',
      title: '对公转账已核销',
      content: `「${order.planName}」转账 ¥${(order.amount / 100).toFixed(2)} 已核销到账，套餐已生效`,
      link: '/t/settings',
    })).catch(() => undefined);

    return { code: 0, message: `已核销，「${order.planName}」套餐已生效`, data: order };
  }
}
