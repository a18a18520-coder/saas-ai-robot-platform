import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 平台设置（对齐原型 platform-settings.html）：Dify 连接 / 全局策略 / 安全策略（单行存储） */
@Entity('platform_settings')
export class PlatformSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Dify 实例地址 */
  @Column({ name: 'dify_url', default: 'http://localhost:5001' })
  difyUrl: string;

  /** Dify 管理员 API Key（AES-256-GCM 密文） */
  @Column({ name: 'dify_api_key', nullable: true })
  difyApiKey?: string;

  /** Dify 服务账号 Key（知识同步用，AES-256-GCM 密文） */
  @Column({ name: 'service_account_key', nullable: true })
  serviceAccountKey?: string;

  /** 新租户默认试用天数 */
  @Column({ name: 'new_tenant_trial_days', type: 'int', default: 14 })
  newTenantTrialDays: number;

  /** 额度预警阈值（%） */
  @Column({ name: 'quota_threshold', type: 'int', default: 80 })
  quotaThreshold: number;

  /** 审计保留期（天） */
  @Column({ name: 'audit_retention_days', type: 'int', default: 180 })
  auditRetentionDays: number;

  /** 会话保留期（天） */
  @Column({ name: 'session_retention_days', type: 'int', default: 90 })
  sessionRetentionDays: number;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
