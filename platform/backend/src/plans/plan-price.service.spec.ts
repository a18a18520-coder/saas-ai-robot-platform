import { PlanPriceService } from './plan-price.service';

describe('PlanPriceService — 30 天周期补价（用户确认公式）', () => {
  const svc = new PlanPriceService();
  const today = new Date('2026-08-21');

  it('示例公式：旧 ¥100 已用 10 天升级 ¥300 → 补 266.67', () => {
    const r = svc.calculateDiff({ oldPlanPrice: 100, newPlanPrice: 300, usedDays: 10, effectType: 'IMMEDIATE', today });
    expect(r.consumedValue).toBe(33.33); // 100÷30×10
    expect(r.diff).toBe(266.67); // 300 − 33.33
  });

  it('原型示例：专业版 ¥1999 已用 10 天升级旗舰 ¥3999 → 补 3332.67', () => {
    const r = svc.calculateDiff({ oldPlanPrice: 1999, newPlanPrice: 3999, usedDays: 10, effectType: 'IMMEDIATE', today });
    expect(r.consumedValue).toBeCloseTo(666.33, 2);
    expect(r.diff).toBeCloseTo(3332.67, 2);
  });

  it('降级不退款：旗舰 ¥3999 已用 20 天降标准 ¥999 → 补 0', () => {
    const r = svc.calculateDiff({ oldPlanPrice: 3999, newPlanPrice: 999, usedDays: 20, effectType: 'IMMEDIATE', today });
    expect(r.diff).toBe(0);
  });

  it('已用天数越界收敛（35 → 30，-5 → 0）', () => {
    expect(svc.calculateDiff({ oldPlanPrice: 100, newPlanPrice: 300, usedDays: 35, effectType: 'IMMEDIATE', today }).usedDays).toBe(30);
    expect(svc.calculateDiff({ oldPlanPrice: 100, newPlanPrice: 300, usedDays: -5, effectType: 'IMMEDIATE', today }).usedDays).toBe(0);
  });

  it('立即生效：新周期 = today + 30 天', () => {
    const r = svc.calculateDiff({ oldPlanPrice: 100, newPlanPrice: 300, usedDays: 0, effectType: 'IMMEDIATE', today });
    expect(r.nextExpireAt).toBe('2026-09-20');
  });
});
