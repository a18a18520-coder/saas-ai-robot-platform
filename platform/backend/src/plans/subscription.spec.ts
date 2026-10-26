import { applyPaidOrder } from './subscription';
describe('paid subscription entitlement', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-10-05T12:00:00+08:00')));
  afterEach(() => jest.useRealTimers());
  const tenant = (): any => ({ planId: 'old', cycleStartAt: '2026-09-15', subscriptionEnd: '2026-10-15', aiQuotaUsed: 12 });
  const order = (effectType: string): any => ({ id: 'o', planId: 'new', entitlement: { effectType, validityDays: 30, basePlanId: 'old', baseCycle: '2026-09-15', baseEnd: '2026-10-15' } });
  it('paid renewal preserves current usage until the next cycle', () => {
    const t = tenant(); applyPaidOrder(t, order('NEXT_CYCLE'));
    expect(t.aiQuotaUsed).toBe(12); expect(t.planId).toBe('old');
    expect(t.pendingSubscription).toEqual({ planId: 'new', orderId: 'o', start: '2026-10-15', end: '2026-11-14' });
  });
  it('immediate upgrade starts a new period and resets usage', () => {
    const t = tenant(); applyPaidOrder(t, order('IMMEDIATE'));
    expect(t).toMatchObject({ planId: 'new', cycleStartAt: '2026-10-05', subscriptionEnd: '2026-11-04', aiQuotaUsed: 0 });
  });
  it('blocks a stale order and a second paid reservation', () => {
    const t = tenant(); t.cycleStartAt = '2026-10-01';
    expect(() => applyPaidOrder(t, order('IMMEDIATE'))).toThrow('已变更');
    const active = tenant(); applyPaidOrder(active, order('NEXT_CYCLE'));
    expect(() => applyPaidOrder(active, order('NEXT_CYCLE'))).toThrow('已有');
  });
});
