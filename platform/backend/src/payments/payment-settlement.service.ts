import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Notification } from '../notifications/notification.entity';
import { Tenant } from '../tenants/tenant.entity';
import { PaymentOrder } from './payment-order.entity';
import type { GatewayPaymentResult } from './payment-gateway.service';
import { localDateISO } from '../common/date.util';
import { applyPaidOrder } from '../plans/subscription';

@Injectable()
export class PaymentSettlementService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
  ) {}

  async settle(provider: 'WECHAT' | 'ALIPAY', payment: GatewayPaymentResult): Promise<PaymentOrder> {
    const result = await this.dataSource.transaction(async (manager) => {
      const orders = manager.getRepository(PaymentOrder);
      const tenants = manager.getRepository(Tenant);
      const order = await orders.findOne({ where: { merchantOrderNo: payment.merchantOrderNo }, lock: { mode: 'pessimistic_write' } });
      if (!order || order.payType !== provider) throw new HttpException('支付订单不存在或渠道不匹配', HttpStatus.NOT_FOUND);
      if (order.amount !== payment.amount) throw new HttpException('支付金额与订单不一致', HttpStatus.UNPROCESSABLE_ENTITY);
      if (order.status === 'PAID') return { order, changed: false, oldPlanId: '' };
      if (order.status !== 'PENDING') throw new HttpException(`订单状态不允许入账（${order.status}）`, HttpStatus.UNPROCESSABLE_ENTITY);
      const tenant = await tenants.findOne({ where: { id: order.tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!tenant) throw new HttpException('租户不存在', HttpStatus.NOT_FOUND);
      const oldPlanId = tenant.planId;
      order.status = 'PAID'; order.paidAt = new Date(); order.gatewayTransactionId = payment.transactionId;
      applyPaidOrder(tenant, order);
      await orders.save(order); await tenants.save(tenant);
      return { order, changed: true, oldPlanId };
    });
    if (result.changed) {
      await this.audit.log({ tenantId: result.order.tenantId, question: `[支付] ${provider === 'WECHAT' ? '微信' : '支付宝'}回调入账（¥${(result.order.amount / 100).toFixed(2)}）`, result: `套餐变更（${result.oldPlanId} → ${result.order.planName}）` }).catch(() => undefined);
      await this.notifications.save(this.notifications.create({ tenantId: result.order.tenantId, type: 'payment', title: '套餐支付成功', content: `「${result.order.planName}」支付 ¥${(result.order.amount / 100).toFixed(2)} 成功，套餐已生效`, link: '/t/settings' })).catch(() => undefined);
    }
    return result.order;
  }
}
