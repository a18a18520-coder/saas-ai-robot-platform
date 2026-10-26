import { Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { AuditLog } from './audit-log.entity';
import { answerCategory, isConversationAudit } from './audit-metrics';
import { FollowUp } from '../follow-ups/follow-up.entity';

/** 审计查询：租户侧 /api/v1/tenant/audit（平台侧 /api/v1/admin/audit 由 platform-audit 模块提供） */
@Controller()
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    @InjectRepository(AuditLog) private readonly audits: Repository<AuditLog>,
  ) {}

  /** 租户侧审计查询（筛选：结果/关键词/机器人/时间范围） */
  @Get('api/v1/tenant/audit')
  tenantList(
    @Query('tenantId') tenantId: string,
    @Query('result') result?: string,
    @Query('keyword') keyword?: string,
    @Query('robotId') robotId?: string,
    @Query('hours') hours?: string,
  ) {
    return this.audit.listTenant(tenantId, {
      result,
      keyword,
      robotId,
      hours: hours ? Number(hours) : undefined,
    });
  }

  /** 租户侧操作日志，与 AI 审计使用独立功能权限。 */
  @Get('api/v1/tenant/logs')
  tenantOperations(@Query('tenantId') tenantId: string, @Query('limit') limit = '100') {
    return this.audit.listTenantOperations(tenantId, Number(limit) || 100);
  }

  /** 审计统计（AI 调用按日趋势 + 结果分布）——审计中心顶部概况卡数据源（本地时区日期） */
  @Get('api/v1/tenant/audit/stats')
  async stats(@Query('tenantId') tenantId: string, @Query('days') days = '14') {
    if (!tenantId) return { code: 40001, message: '参数缺失: tenantId', data: null };
    const n = Math.min(30, Math.max(3, Number(days) || 14));
    const since = new Date();
    since.setDate(since.getDate() - (n - 1));
    since.setHours(0, 0, 0, 0);

    const rows = await this.audits.find({ where: { tenantId, createdAt: MoreThanOrEqual(since) } });
    const ai = rows.filter(isConversationAudit);
    const followUps = await this.audits.manager.getRepository(FollowUp).find({ where: { tenantId, createdAt: MoreThanOrEqual(since) } });

    // 本地时区日期 key（服务器本地时区，与前端 fmt 系列一致）
    const off = new Date().getTimezoneOffset() * 60000;
    const dayKey = (d: Date) => new Date(d.getTime() - off).toISOString().slice(0, 10);
    const isHit = (r: AuditLog) => answerCategory(r) === 'hit';
    const isDenied = (r: AuditLog) => answerCategory(r) === 'denied';

    const map = new Map<string, { date: string; ai: number; hit: number; handoff: number; denied: number }>();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      map.set(dayKey(d), { date: dayKey(d), ai: 0, hit: 0, handoff: 0, denied: 0 });
    }
    for (const r of ai) {
      const e = map.get(dayKey(new Date(r.createdAt)));
      if (!e) continue;
      e.ai++;
      if (isHit(r)) e.hit++;
      else if (isDenied(r)) e.denied++;
    }
    for (const item of followUps) {
      const e = map.get(dayKey(new Date(item.createdAt)));
      if (e) e.handoff++;
    }
    const total = ai.length;
    const dist = {
      total,
      hit: ai.filter(isHit).length,
      handoff: followUps.length,
      denied: ai.filter(isDenied).length,
      insufficient: ai.filter(r => answerCategory(r) === 'insufficient').length,
      failed: ai.filter(r => answerCategory(r) === 'failed').length,
      tool: ai.filter(r => answerCategory(r) === 'tool').length,
      other: ai.filter(r => answerCategory(r) === 'other').length,
    };
    return { code: 0, message: 'success', data: { days: n, daily: [...map.values()], dist } };
  }
}
