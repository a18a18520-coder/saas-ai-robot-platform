import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentOrder } from './payment-order.entity';
import { Tenant } from '../tenants/tenant.entity';
import { Plan } from '../plans/plan.entity';
import { AuditService } from '../audit/audit.service';
import { Notification } from '../notifications/notification.entity';
import { randomBytes } from 'crypto';
import { PaymentGatewayService } from './payment-gateway.service';
import { ConfigService } from '@nestjs/config';
import { localDateISO } from '../common/date.util';
import { applyPaidOrder, subscriptionEnd } from '../plans/subscription';

/** 套餐支付（租户侧）：创建订单 → 扫码/对公转账 → 确认支付 → 套餐生效 */
@Controller('api/v1/tenant/payments')
export class PaymentsController {
  constructor(
    @InjectRepository(PaymentOrder) private readonly orders: Repository<PaymentOrder>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    private readonly audit: AuditService,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    private readonly gateway: PaymentGatewayService,
    private readonly config: ConfigService,
  ) {}

  /** 支付记录列表（历史订单，支持查看支付记录） */
  @Get()
  async list(@Query('tenantId') tenantId: string) {
    if (!tenantId) throw new HttpException({ code: 40001, message: '参数缺失: tenantId', data: null }, HttpStatus.BAD_REQUEST);
    const orders = await this.orders.find({ where: { tenantId }, order: { createdAt: 'DESC' }, take: 50 });
    return { code: 0, message: 'success', data: orders };
  }

  /** 创建支付订单（差价 = 新套餐价 − 旧套餐按已用天数折算；降级不退款 → 免支付直接切换） */
  @Post()
  async create(@Body() body: { tenantId: string; planId: string; payType?: 'WECHAT' | 'ALIPAY' | 'BANK_TRANSFER'; effectType?: 'IMMEDIATE' | 'NEXT_CYCLE' }) {
    const { tenantId, planId, payType = 'WECHAT' } = body ?? {};
    if (!tenantId || !planId) throw new HttpException({ code: 40001, message: 'tenantId/planId 必填', data: null }, HttpStatus.BAD_REQUEST);
    if (!['WECHAT', 'ALIPAY', 'BANK_TRANSFER'].includes(payType)) throw new HttpException({ code: 40001, message: '支付方式不合法', data: null }, HttpStatus.BAD_REQUEST);
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) throw new HttpException({ code: 40401, message: '租户不存在', data: null }, HttpStatus.NOT_FOUND);
    const plan = await this.plans.findOne({ where: { id: planId } });
    if (!plan || !plan.isActive) throw new HttpException({ code: 40401, message: '套餐不存在或未启用', data: null }, HttpStatus.NOT_FOUND);
    if (tenant.pendingSubscription) throw new HttpException('已有已支付的下周期套餐，请勿重复购买', 409);
    if (body.effectType && !['IMMEDIATE', 'NEXT_CYCLE'].includes(body.effectType)) throw new HttpException('生效方式无效', 400);

    // 差价计算：oldValue = 旧价 ÷ 30 × 已用天数；diff = 新价 − oldValue
    let amount = plan.price * 100; // 默认全价（分）
    let oldPlan: Plan | null = null;
    try { oldPlan = await this.plans.findOne({ where: { id: tenant.planId } }); } catch { oldPlan = null; }
    // 降级（新价 < 旧价）：当前套餐到期前禁止降级，到期后方可向下购买
    const expired = !oldPlan || subscriptionEnd(tenant, oldPlan) <= localDateISO();
    const effectType = expired ? 'IMMEDIATE' : body.effectType ?? (tenant.planId === plan.id ? 'NEXT_CYCLE' : 'IMMEDIATE');
    if (tenant.planId === plan.id && !expired && effectType === 'IMMEDIATE') throw new HttpException('续费在下周期生效，不重复清零额度', 409);
    if (oldPlan && !expired && effectType === 'IMMEDIATE' && plan.price < oldPlan.price) {
      throw new HttpException(
        { code: 42201, message: `当前套餐「${oldPlan.name}」未到期，到期后方可降级至「${plan.name}」`, data: null },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (oldPlan && !expired && effectType === 'IMMEDIATE' && oldPlan.price > 0 && tenant.cycleStartAt) {
      const start = new Date(tenant.cycleStartAt).getTime();
      const days = oldPlan.validityDays > 0 ? oldPlan.validityDays : 30;
      const usedDays = Math.max(0, Math.min(days, Math.floor((Date.now() - start) / 86400000)));
      const oldValue = (oldPlan.price / days) * usedDays;
      amount = Math.max(0, Math.round((plan.price - oldValue) * 100));
    }

    // 已付覆盖（差价 ≤ 0）→ 免支付直接切换
    const entitlement: PaymentOrder['entitlement'] = { effectType, validityDays: plan.validityDays, basePlanId: tenant.planId, baseCycle: tenant.cycleStartAt, baseEnd: tenant.subscriptionEnd };
    if (amount <= 0) {
      await this.tenants.manager.transaction(async manager => {
        const current = await manager.findOne(Tenant, { where: { id: tenantId }, lock: { mode: 'pessimistic_write' } });
        if (!current) throw new HttpException('租户不存在', 404);
        const order = manager.create(PaymentOrder, { tenantId, planId, planName: plan.name, amount: 0, payType, status: 'PAID', paidAt: new Date(), entitlement });
        await manager.save(order); applyPaidOrder(current, order); await manager.save(current);
      });
      await this.audit.log({ tenantId, question: `[支付] 套餐变更（免付）`, result: `套餐变更（→ ${plan.name}）` });
      return { code: 0, message: `已切换至「${plan.name}」（无需补付）`, data: { directSwitch: true } };
    }

    const merchantOrderNo = `S${Date.now().toString(36)}${randomBytes(5).toString('hex')}`.toUpperCase();
    const qrContent = payType === 'BANK_TRANSFER'
      ? undefined
      : await this.gateway.createNativeOrder(payType, merchantOrderNo, amount, `购买${plan.name}`);

    const order = await this.orders.save(this.orders.create({
      tenantId, planId, planName: plan.name,
      amount, payType,
      merchantOrderNo,
      qrContent,
      bankInfo: payType === 'BANK_TRANSFER' ? this.bankInfo() : undefined,
      entitlement,
      status: 'PENDING',
    }));
    return { code: 0, message: '订单已创建，请完成支付', data: order };
  }

  /** 订单查询（前端轮询状态） */
  @Get(':id')
  async detail(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    const order = await this.orders.findOne({ where: { id, tenantId } });
    if (!order) throw new HttpException({ code: 40401, message: '订单不存在', data: null }, HttpStatus.NOT_FOUND);
    return { code: 0, message: 'success', data: order };
  }

  /** 对公转账提交核销；扫码支付只能由已验签的网关回调确认。 */
  @Post(':id/confirm')
  async confirm(@Param('id') id: string, @Query('tenantId') tenantId: string, @Body() body: { remark?: string }) {
    if (!tenantId) throw new HttpException({ code: 40001, message: '参数缺失: tenantId', data: null }, HttpStatus.BAD_REQUEST);
    const order = await this.orders.findOne({ where: { id, tenantId } });
    if (!order) throw new HttpException({ code: 40401, message: '订单不存在', data: null }, HttpStatus.NOT_FOUND);
    if (order.status === 'PAID') return { code: 42201, message: '订单已支付', data: order };
    if (order.status === 'PENDING_VERIFICATION') throw new HttpException({ code: 42201, message: '订单待平台核销，核销后套餐生效', data: order }, HttpStatus.UNPROCESSABLE_ENTITY);
    if (order.status !== 'PENDING') throw new HttpException({ code: 42201, message: `订单状态不允许支付（${order.status}）`, data: null }, HttpStatus.UNPROCESSABLE_ENTITY);

    if (body?.remark) order.remark = body.remark;

    // 对公转账：标记待核销，套餐暂不生效，通知平台核销
    if (order.payType === 'BANK_TRANSFER') {
      order.status = 'PENDING_VERIFICATION';
      await this.orders.save(order);
      await this.notifications.save(this.notifications.create({
        tenantId: 'platform',
        type: 'verification',
        title: '对公转账待核销',
        content: `租户「${(await this.tenants.findOne({ where: { id: order.tenantId } }))?.name ?? order.tenantId.slice(0, 8)}」转账 ¥${(order.amount / 100).toFixed(2)} 购买「${order.planName}」，请核对到账`,
        link: '/payments',
      })).catch(() => undefined);
      return { code: 0, message: '已提交转账信息，等待平台核销后套餐生效', data: order };
    }

    throw new HttpException({ code: 42201, message: '扫码支付正在等待支付网关确认，请勿手工确认', data: order }, HttpStatus.UNPROCESSABLE_ENTITY);
  }

  /** 取消订单 */
  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    const order = await this.orders.findOne({ where: { id, tenantId } });
    if (!order) throw new HttpException({ code: 40401, message: '订单不存在', data: null }, HttpStatus.NOT_FOUND);
    if (order.status !== 'PENDING') throw new HttpException({ code: 42201, message: '订单不可取消', data: null }, HttpStatus.UNPROCESSABLE_ENTITY);
    order.status = 'CANCELLED';
    await this.orders.save(order);
    return { code: 0, message: '订单已取消', data: order };
  }

  private bankInfo(): Record<string, string> {
    const accountName = this.config.get<string>('BANK_ACCOUNT_NAME');
    const accountNo = this.config.get<string>('BANK_ACCOUNT_NO');
    const bank = this.config.get<string>('BANK_NAME');
    if (!accountName || !accountNo || !bank) {
      throw new HttpException({ code: 50301, message: '对公收款账户尚未配置', data: null }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { accountName, accountNo, bank };
  }
}
