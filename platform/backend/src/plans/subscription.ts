import { BadRequestException } from '@nestjs/common';
import { localDateISO } from '../common/date.util';
import { Tenant } from '../tenants/tenant.entity';
import { Plan } from './plan.entity';
import { PaymentOrder } from '../payments/payment-order.entity';

export function addDays(date: string, days: number) {
  const [y, m, d] = date.split('-').map(Number);
  const result = new Date(y, m - 1, d); result.setDate(result.getDate() + days);
  return localDateISO(result);
}
export function subscriptionEnd(tenant: Tenant, plan: Plan) {
  return tenant.subscriptionEnd || addDays(tenant.cycleStartAt, plan.validityDays || 30);
}
export function applyPaidOrder(tenant: Tenant, order: PaymentOrder) {
  const terms = order.entitlement ?? {};
  if (terms.basePlanId && (tenant.planId !== terms.basePlanId || tenant.cycleStartAt !== terms.baseCycle || tenant.subscriptionEnd !== terms.baseEnd)) throw new BadRequestException('订单对应套餐已变更，请平台核对订单，避免重复重置额度');
  if (tenant.pendingSubscription) throw new BadRequestException('已有已支付的下周期套餐，请平台核对，不能覆盖');
  const today = localDateISO();
  const scheduled = terms.effectType === 'NEXT_CYCLE' && !!tenant.subscriptionEnd && tenant.subscriptionEnd > today;
  const start = scheduled ? tenant.subscriptionEnd! : today;
  const end = addDays(start, terms.validityDays || 30);
  if (scheduled) tenant.pendingSubscription = { planId: order.planId, start, end, orderId: order.id };
  else { tenant.planId = order.planId; tenant.cycleStartAt = start; tenant.subscriptionEnd = end; tenant.aiQuotaUsed = 0; tenant.isTrial = false; }
}
