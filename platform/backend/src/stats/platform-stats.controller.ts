import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { Plan } from '../plans/plan.entity';
import { Robot } from '../robots/robot.entity';
import { Group } from '../groups/group.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { PaymentOrder } from '../payments/payment-order.entity';
import { quotaAlertLevel } from '../common/quota.util';
import { isConversationAudit } from '../audit/audit-metrics';

/** 平台侧聚合统计（对齐原型 platform-dashboard / platform-stats，真实数据） */
@Controller('api/v1/admin/stats')
export class PlatformStatsController {
  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    @InjectRepository(Robot) private readonly robots: Repository<Robot>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(AuditLog) private readonly audits: Repository<AuditLog>,
    @InjectRepository(PaymentOrder) private readonly payments: Repository<PaymentOrder>,
  ) {}

  @Get()
  async stats() {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6); weekAgo.setHours(0, 0, 0, 0);

    const [tenantTotal, tenantActive, tenantDisabled, tenantPending, tenantsThisMonth] = await Promise.all([
      this.tenants.count(),
      this.tenants.count({ where: { status: 'ACTIVE' } }),
      this.tenants.count({ where: { status: 'DISABLED' } }),
      this.tenants.count({ where: { status: 'PENDING_ACTIVATION' } }),
      this.tenants.count({ where: { createdAt: MoreThanOrEqual(monthStart) } }),
    ]);

    // 今日全平台调用 + P95
    const todayAudits = (await this.audits.find({ where: { createdAt: MoreThanOrEqual(todayStart) } })).filter(isConversationAudit);
    const durations = todayAudits.filter((a) => a.durationMs > 0).map((a) => a.durationMs).sort((a, b) => a - b);
    const p95Ms = durations.length ? durations[Math.floor(durations.length * 0.95)] : null;

    // 近 7 日趋势（全平台）
    const fmtDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const trendMap: Record<string, { ai: number; handoff: number }> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekAgo); d.setDate(weekAgo.getDate() + i);
      trendMap[fmtDay(d)] = { ai: 0, handoff: 0 };
    }
    for (const a of (await this.audits.find({ where: { createdAt: MoreThanOrEqual(weekAgo) } })).filter(isConversationAudit)) {
      const day = trendMap[fmtDay(a.createdAt)];
      if (!day) continue;
      day.ai++;
      if (a.result === '未命中转人工' || a.result === '证据不足') day.handoff++;
    }
    const trend7d = Object.entries(trendMap).map(([date, v]) => ({ date, ...v }));

    // 套餐分布
    const planCount: Record<string, number> = {};
    const allTenants = await this.tenants.find();
    const pMap = new Map((await this.plans.find()).map((p) => [p.id, p]));
    for (const t of allTenants) {
      const name = pMap.get(t.planId)?.name ?? '未知';
      planCount[name] = (planCount[name] ?? 0) + 1;
    }

    // 渠道分布（按群 channel 统计）
    const channelCount: Record<string, number> = {};
    for (const g of await this.groups.find()) {
      channelCount[g.channel ?? 'wecom'] = (channelCount[g.channel ?? 'wecom'] ?? 0) + 1;
    }

    // 租户用量排行（套餐名/本月调用/额度%/机器人数）
    const usage = [];
    for (const t of allTenants.sort((a, b) => b.aiQuotaUsed - a.aiQuotaUsed).slice(0, 10)) {
      const plan = pMap.get(t.planId);
      const monthCalls = t.aiQuotaUsed;
      const robotCount = await this.robots.count({ where: { tenantId: t.id } });
      const alertLevel = plan ? quotaAlertLevel(t.config, t.aiQuotaUsed, plan.aiQuota) : undefined;
      usage.push({
        tenantId: t.id,
        tenantName: t.name,
        planName: plan?.name ?? '—',
        monthCalls,
        quotaUsedPct: plan && plan.aiQuota > 0 ? Math.round((t.aiQuotaUsed / plan.aiQuota) * 100) : 0,
        robotCount,
        status: t.status,
        overQuota: plan && plan.aiQuota > 0 && t.aiQuotaUsed >= plan.aiQuota,
        alertLevel,
      });
    }

    // 租户增长趋势（近 30 天新增累计曲线）
    const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 29); thirtyAgo.setHours(0, 0, 0, 0);
    const growth: Array<{ date: string; count: number }> = [];
    let running = 0;
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyAgo); d.setDate(thirtyAgo.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      running += allTenants.filter((t) => fmtDay(t.createdAt) === key).length;
      growth.push({ date: key, count: running });
    }

    return {
      code: 0,
      message: 'success',
      data: {
        tenants: { total: tenantTotal, active: tenantActive, disabled: tenantDisabled, pending: tenantPending, thisMonth: tenantsThisMonth },
        tenantGrowth: growth,
        todayCalls: todayAudits.length,
        p95Ms,
        trend7d,
        planDistribution: planCount,
        channelDistribution: channelCount,
        tenantUsage: usage,
        // 月度收入（Σ 已支付订单金额，真实支付数据）
        revenue: await this.calcRevenue(monthStart),
      },
    };
  }

  /** 收入统计：月度总金额（元）+ 近 30 天每日收入 */
  private async calcRevenue(monthStart: Date): Promise<{ monthTotal: number; monthTotalYuan: number; daily: Array<{ date: string; amount: number }> } | null> {
    const paid = await this.payments.find({ where: { status: 'PAID' } });
    if (!paid.length) return null;
    const fmtDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const monthTotal = paid.filter((o) => o.paidAt && o.paidAt >= monthStart).reduce((a, o) => a + o.amount, 0);
    // 近 30 天每日收入
    const dailyMap: Record<string, number> = {};
    for (const o of paid) {
      if (!o.paidAt) continue;
      const key = fmtDay(o.paidAt);
      dailyMap[key] = (dailyMap[key] ?? 0) + o.amount;
    }
    const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 29); thirtyAgo.setHours(0, 0, 0, 0);
    const daily: Array<{ date: string; amount: number }> = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyAgo); d.setDate(thirtyAgo.getDate() + i);
      daily.push({ date: fmtDay(d), amount: Math.round((dailyMap[fmtDay(d)] ?? 0) / 100) });
    }
    return { monthTotal, monthTotalYuan: Math.round(monthTotal / 100), daily };
  }
}
