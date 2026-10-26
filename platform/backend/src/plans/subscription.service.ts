import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
@Injectable()
export class SubscriptionService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  constructor(private readonly db: DataSource) {}
  async usage(tenantId: string) {
    const [row] = await this.db.query(`SELECT (SELECT count(*)::int FROM robots WHERE tenant_id=$1 AND status<>'DELETED') AS robots, (SELECT count(*)::int FROM groups WHERE tenant_id=$1 AND status='BOUND') AS groups, ((SELECT COALESCE(sum(size),0) FROM ingestion_jobs WHERE tenant_id=$1) + (SELECT COALESCE(sum(f.size),0) FROM knowledge_files f WHERE f.tenant_id=$1 AND NOT EXISTS(SELECT 1 FROM ingestion_jobs j WHERE j.tenant_id=f.tenant_id AND j.dataset_id=f.dataset_id AND j.source_id=f.source_id AND j.source_version=f.source_version)))::text AS bytes`, [tenantId]);
    return { robots: row.robots, groups: row.groups, storageMb: Number(row.bytes) / 1048576 };
  }
  async activateDue(tenantId?: string) {
    await this.db.query(`UPDATE tenants SET plan_id=pending_subscription->>'planId', cycle_start_at=(pending_subscription->>'start')::date, subscription_end=(pending_subscription->>'end')::date, ai_quota_used=0, is_trial=false, pending_subscription=NULL WHERE pending_subscription IS NOT NULL AND (pending_subscription->>'start')::date <= CURRENT_DATE AND ($1::text IS NULL OR id::text=$1)`, [tenantId ?? null]);
  }
  onModuleInit() { this.timer = setInterval(() => { void this.activateDue().catch(() => undefined); }, 15000); this.timer.unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
