import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 租户（FR-001 平台侧）——生命周期四态：ACTIVE ⇄ DISABLED → DELETED */
@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ name: 'plan_id' })
  planId: string;

  @Column({ default: 'ACTIVE' })
  status: 'ACTIVE' | 'DISABLED' | 'PENDING_ACTIVATION' | 'DELETED';

  /** 当前 30 天周期开始日 */
  @Column({ name: 'cycle_start_at', type: 'date' })
  cycleStartAt: string;
  @Column({ name: 'subscription_end', type: 'date', nullable: true }) subscriptionEnd?: string;
  @Column({ name: 'pending_subscription', type: 'jsonb', nullable: true }) pendingSubscription?: { planId: string; start: string; end: string; orderId: string } | null;

  /** 租户管理员账号 */
  @Column({ name: 'admin_email' })
  adminEmail: string;

  @Column({ name: 'admin_account_id', nullable: true })
  adminAccountId?: string;

  @Column({ name: 'ai_quota_used', type: 'int', default: 0 })
  aiQuotaUsed: number;

  @Column({ name: 'is_trial', default: false })
  isTrial: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  /** 禁用原因（平台操作记录） */
  @Column({ name: 'disabled_reason', nullable: true })
  disabledReason?: string;

  /** 删除时间（软删除，合规保留期） */
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date;

  /** 租户偏好（额度预警阈值/通知方式等，JSON 存储） */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  config: Record<string, unknown>;
}
