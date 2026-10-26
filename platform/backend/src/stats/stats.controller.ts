import { Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { AuditLog } from '../audit/audit-log.entity';
import { Tenant } from '../tenants/tenant.entity';
import { Plan } from '../plans/plan.entity';
import { Robot } from '../robots/robot.entity';
import { Group } from '../groups/group.entity';
import { User } from '../users/user.entity';
import { Conversation } from '../sessions/conversation.entity';
import { KnowledgeBase } from '../knowledge/knowledge-base.entity';
import { FollowUp } from '../follow-ups/follow-up.entity';
import { Channel } from '../channels/channel.entity';
import { isConversationAudit } from '../audit/audit-metrics';

/** 租户工作台统计 + 套餐额度（真实数据，零造假） */
@Controller('api/v1/tenant/stats')
export class StatsController {
  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    @InjectRepository(Robot) private readonly robots: Repository<Robot>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Conversation) private readonly convs: Repository<Conversation>,
    @InjectRepository(KnowledgeBase) private readonly kbs: Repository<KnowledgeBase>,
    @InjectRepository(FollowUp) private readonly followUps: Repository<FollowUp>,
    @InjectRepository(Channel) private readonly channels: Repository<Channel>,
    @InjectRepository(AuditLog) private readonly audits: Repository<AuditLog>,
  ) {}

  @Get()
  async stats(@Query('tenantId') tenantId: string) {
    if (!tenantId) return { code: 40001, message: '参数缺失: tenantId', data: null };
    const [robots, robotsPub] = await Promise.all([
      this.robots.count({ where: { tenantId } }),
      this.robots.count({ where: { tenantId, status: 'PUBLISHED' } }),
    ]);
    const [groups, groupsBound] = await Promise.all([
      this.groups.count({ where: { tenantId } }),
      this.groups.count({ where: { tenantId, status: 'BOUND' } }),
    ]);
    const [users, sessions, kbs, followUpsPending, channels] = await Promise.all([
      this.users.count({ where: { tenantId } }),
      this.convs.count({ where: { tenantId } }),
      this.kbs.count({ where: { tenantId } }),
      this.followUps.count({ where: { tenantId, status: 'pending' } }),
      this.channels.count({ where: { tenantId } }),
    ]);
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    // planId 可能为种子字符串（非 uuid）→ 容错跳过套餐信息
    let plan = null;
    if (tenant?.planId) {
      try {
        plan = await this.plans.findOne({ where: { id: tenant.planId } });
      } catch {
        plan = null;
      }
    }

    // —— 工作台指标（对齐原型 dashboard.html）——
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6); weekAgo.setHours(0, 0, 0, 0);

    const [robotsThisMonth, robotsDraft, followUpsToday] = await Promise.all([
      this.robots.count({ where: { tenantId, createdAt: MoreThanOrEqual(monthStart) } }),
      this.robots.count({ where: { tenantId, status: 'DRAFT' } }),
      this.followUps.count({ where: { tenantId, createdAt: MoreThanOrEqual(todayStart) } }),
    ]);

    // 今日 AI 调用 + P95（审计 duration_ms 真实数据，无调用则不造假返回 null）
    const todayAudits = (await this.audits.find({ where: { tenantId, createdAt: MoreThanOrEqual(todayStart) } })).filter(isConversationAudit);
    const durations = todayAudits.filter((a) => a.durationMs > 0).map((a) => a.durationMs).sort((a, b) => a - b);
    const p95Ms = durations.length ? durations[Math.floor(durations.length * 0.95)] : null;

    // 近 7 日趋势（审计按天分组：AI 对话量 / 未命中转人工量）
    const fmtDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const trendMap: Record<string, { ai: number; handoff: number }> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekAgo); d.setDate(weekAgo.getDate() + i);
      trendMap[fmtDay(d)] = { ai: 0, handoff: 0 };
    }
    const weekAudits = (await this.audits.find({ where: { tenantId, createdAt: MoreThanOrEqual(weekAgo) } })).filter(isConversationAudit);
    for (const a of weekAudits) {
      const day = trendMap[fmtDay(a.createdAt)];
      if (!day) continue;
      day.ai++;
    }
    for (const item of await this.followUps.find({ where: { tenantId, createdAt: MoreThanOrEqual(weekAgo) } })) {
      const day = trendMap[fmtDay(item.createdAt)];
      if (day) day.handoff++;
    }
    const trend7d = Object.entries(trendMap).map(([date, v]) => ({ date, ...v }));

    // 最近审计 5 条 + 机器人名映射（工作台记录表）
    const recentAudits = (await this.audits.find({ where: { tenantId }, order: { createdAt: 'DESC' } })).filter(isConversationAudit).slice(0, 5);
    const robotsMap: Record<string, string> = {};
    for (const r of await this.robots.find({ where: { tenantId } })) robotsMap[r.id] = r.name;
    return {
      code: 0,
      message: 'success',
      data: {
        robots: { total: robots, published: robotsPub },
        groups: { total: groups, bound: groupsBound },
        users,
        sessions,
        knowledgeBases: kbs,
        followUpsPending,
        channels,
        // 工作台指标（对齐原型）
        robotsThisMonth,
        robotsDraft,
        todayCalls: todayAudits.length,
        p95Ms,
        trend7d,
        recentAudits: recentAudits.map((a) => ({
          id: a.id,
          time: a.createdAt.toISOString(),
          robotName: a.robotId ? (robotsMap[a.robotId] ?? a.robotId.slice(0, 8)) : '—',
          user: a.channelUserId ? a.channelUserId.slice(0, 12) : '—',
          question: a.question,
          hit: a.datasetHits?.length ? (a.datasetHits[0] as { content?: string }).content?.slice(0, 40) ?? '命中' : null,
          result: a.result,
          durationMs: a.durationMs,
        })),
        followUpsToday,
        plan: plan
          ? {
              name: plan.name,
              robotLimit: plan.robotLimit,
              userLimit: plan.userLimit,
              kbLimit: plan.kbLimit,
              channelLimit: plan.channelLimit,
              fileSizeLimitMb: plan.fileSizeLimitMb,
              aiQuota: plan.aiQuota,
              aiQuotaUsed: tenant?.aiQuotaUsed ?? 0,
              usage: { robots, users, knowledgeBases: kbs, channels },
            }
          : null,
      },
    };
  }
}
