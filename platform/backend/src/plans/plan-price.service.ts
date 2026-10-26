import { Injectable } from '@nestjs/common';
import { localDateISO } from '../common/date.util';

/**
 * 30 天有效期周期补价计算（FR-001，用户确认公式）：
 *   应补差价 = 新套餐价 −（旧套餐价 ÷ 30 × 已用天数）
 *   例：旧 ¥100 已用 10 天升级 ¥300 → 300 − 100÷30×10 = 266.67
 * 规则：
 *   - 降级（差值 ≤ 0）→ 补价 0（不退款）
 *   - 已用天数 0-30，越界收敛
 *   - 服务端权威计算（不信任前端传值，只信任套餐表价格）
 */
export interface PriceDiffResult {
  newPrice: number;
  oldPrice: number;
  usedDays: number;
  /** 旧套餐已消耗价值 = 旧价 ÷ 30 × 天数 */
  consumedValue: number;
  /** 应补差价（降级为 0，不退款） */
  diff: number;
  /** 生效方式 */
  effectType: 'IMMEDIATE' | 'NEXT_CYCLE';
  /** 新周期到期日（立即生效：从 today + 30 天） */
  nextExpireAt: string;
}

@Injectable()
export class PlanPriceService {
  static readonly CYCLE_DAYS = 30;

  calculateDiff(params: {
    oldPlanPrice: number;
    newPlanPrice: number;
    usedDays: number;
    effectType: 'IMMEDIATE' | 'NEXT_CYCLE';
    today?: Date;
    oldValidityDays?: number;
    newValidityDays?: number;
  }): PriceDiffResult {
    const cycle = params.oldValidityDays || 30;
    const days = Math.min(cycle, Math.max(0, Math.floor(params.usedDays)));
    const consumed = (params.oldPlanPrice / cycle) * days;
    const rawDiff = params.newPlanPrice - consumed;
    const diff = params.effectType === 'NEXT_CYCLE' || params.usedDays >= cycle ? params.newPlanPrice : rawDiff > 0 ? Math.round(rawDiff * 100) / 100 : 0;

    const base = params.today ?? new Date();
    const next = new Date(base);
    next.setDate(next.getDate() + (params.newValidityDays || 30));

    return {
      newPrice: params.newPlanPrice,
      oldPrice: params.oldPlanPrice,
      usedDays: days,
      consumedValue: Math.round(consumed * 100) / 100,
      diff,
      effectType: params.effectType,
      nextExpireAt: localDateISO(next),
    };
  }
}
