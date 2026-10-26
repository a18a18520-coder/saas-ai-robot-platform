import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { localDateISO } from '../common/date.util';
import { Notification } from '../notifications/notification.entity';
import { Plan } from '../plans/plan.entity';
import { Tenant } from '../tenants/tenant.entity';
import { quotaAlertLevel } from '../common/quota.util';
import { subscriptionEnd } from '../plans/subscription';
import { SubscriptionService } from '../plans/subscription.service';

export interface QuotaConsumption {
  allowed: boolean;
  used: number;
  limit: number;
  alertLevel?: 'REMINDER' | 'STRONG';
  reason?: 'tenant_inactive' | 'plan_missing' | 'quota_exceeded' | 'subscription_expired';
}

/** AI 额度计量：新周期重置 + 数据库条件更新，并发下不超卖。 */
@Injectable()
export class AiQuotaService {
  private readonly logger = new Logger(AiQuotaService.name);

  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly subscriptions?: SubscriptionService,
  ) {}

  async consume(tenantId: string): Promise<QuotaConsumption> {
    await this.subscriptions?.activateDue(tenantId);
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant || tenant.status !== 'ACTIVE') {
      return {
        allowed: false,
        used: tenant?.aiQuotaUsed ?? 0,
        limit: 0,
        reason: 'tenant_inactive',
      };
    }
    const plan = await this.plans.findOne({ where: { id: tenant.planId } });
    if (!plan)
      return {
        allowed: false,
        used: tenant.aiQuotaUsed,
        limit: 0,
        reason: 'plan_missing',
      };

    if (subscriptionEnd(tenant, plan) <= localDateISO(new Date(Date.now()))) return { allowed: false, used: tenant.aiQuotaUsed, limit: plan.aiQuota, reason: 'subscription_expired' };
    const update = this.tenants
      .createQueryBuilder()
      .update(Tenant)
      .set({ aiQuotaUsed: () => '"ai_quota_used" + 1' })
      .where('id = :tenantId', { tenantId })
      .andWhere('status = :status', { status: 'ACTIVE' })
      .andWhere('plan_id = :planId AND cycle_start_at = :cycle', { planId: tenant.planId, cycle: tenant.cycleStartAt })
      .andWhere('(subscription_end IS NULL OR subscription_end > CURRENT_DATE)');
    if (plan.aiQuota > 0) {
      update.andWhere('"ai_quota_used" < :limit', { limit: plan.aiQuota });
    }
    const result = await update.returning(['ai_quota_used']).execute();

    if (result.affected !== 1) {
      const current = await this.tenants.findOne({ where: { id: tenantId } });
      if (!current || current.status !== 'ACTIVE') {
        return {
          allowed: false,
          used: current?.aiQuotaUsed ?? tenant.aiQuotaUsed,
          limit: plan.aiQuota,
          reason: 'tenant_inactive',
        };
      }
      return {
        allowed: false,
        used: current.aiQuotaUsed,
        limit: plan.aiQuota,
        reason: 'quota_exceeded',
      };
    }

    const used = Number(
      result.raw?.[0]?.ai_quota_used ?? tenant.aiQuotaUsed + 1,
    );
    const alertLevel = quotaAlertLevel(tenant.config, used, plan.aiQuota);
    if (alertLevel) {
      await this.notifyOnce(tenant, used, plan.aiQuota, alertLevel).catch(
        (error: unknown) =>
          this.logger.warn(
            `AI 额度预警通知失败: ${error instanceof Error ? error.message : String(error)}`,
          ),
      );
    }
    return { allowed: true, used, limit: plan.aiQuota, alertLevel };
  }

  private async resetExpiredCycle(tenant: Tenant, plan: Plan): Promise<void> {
    const cycleStartedAt = this.localDate(tenant.cycleStartAt);
    const validityDays = Math.max(1, plan.validityDays || 30);
    if (
      cycleStartedAt &&
      Date.now() - cycleStartedAt.getTime() < validityDays * 86_400_000
    )
      return;

    const nextCycle = localDateISO();
    const reset = await this.tenants
      .createQueryBuilder()
      .update(Tenant)
      .set({ cycleStartAt: nextCycle, aiQuotaUsed: 0 })
      .where('id = :tenantId', { tenantId: tenant.id })
      .andWhere('cycle_start_at = :previousCycle', {
        previousCycle: tenant.cycleStartAt,
      })
      .execute();
    if (reset.affected === 1) {
      tenant.cycleStartAt = nextCycle;
      tenant.aiQuotaUsed = 0;
      return;
    }

    // 另一个并发请求已重置周期，重读当前值用于返回和预警计算。
    const current = await this.tenants.findOne({ where: { id: tenant.id } });
    if (current) {
      tenant.cycleStartAt = current.cycleStartAt;
      tenant.aiQuotaUsed = current.aiQuotaUsed;
    }
  }

  private async notifyOnce(
    tenant: Tenant,
    used: number,
    limit: number,
    level: 'REMINDER' | 'STRONG',
  ): Promise<void> {
    const title = `AI 额度预警（${level === 'STRONG' ? '强提醒' : '提醒'}）`;
    const cycleStart = this.localDate(tenant.cycleStartAt) ?? new Date(0);
    const existing = await this.notifications.findOne({
      where: {
        tenantId: tenant.id,
        type: 'quota',
        title,
        createdAt: MoreThanOrEqual(cycleStart),
      },
    });
    if (!existing) {
      const percent = Math.round((used / limit) * 100);
      await this.notifications.save(
        this.notifications.create({
          tenantId: tenant.id,
          type: 'quota',
          title,
          content: `本周期 AI 调用已达 ${percent}%（${used}/${limit} 次）${level === 'STRONG' ? '，即将达到上限' : ''}`,
          link: '/t/settings',
        }),
      );
    }
    if (level === 'STRONG') {
      const platformTitle = `租户额度强提醒：${tenant.name}`;
      const platformExisting = await this.notifications.findOne({
        where: {
          tenantId: 'platform',
          type: 'quota',
          title: platformTitle,
          createdAt: MoreThanOrEqual(cycleStart),
        },
      });
      if (!platformExisting) {
        await this.notifications.save(
          this.notifications.create({
            tenantId: 'platform',
            type: 'quota',
            title: platformTitle,
            content: `租户「${tenant.name}」本周期 AI 用量已达 ${used}/${limit} 次，请关注续费或升级`,
            link: `/tenants/${tenant.id}`,
          }),
        );
      }
    }
  }

  private localDate(value: string | undefined): Date | null {
    const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
}
