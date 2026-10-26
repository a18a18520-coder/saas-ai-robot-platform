import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 全链路审计（FR-015）：谁问/问什么/用什么知识/调什么接口/返回什么 */
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'robot_id', nullable: true })
  robotId?: string;

  @Column({ name: 'user_id', nullable: true })
  userId?: string;

  @Column({ name: 'channel_user_id', nullable: true })
  channelUserId?: string;

  @Column({ type: 'text' })
  question: string;

  /** 知识命中切片（JSON：dataset_id/content） */
  @Column({ name: 'dataset_hits', type: 'jsonb', nullable: true })
  datasetHits?: unknown[];

  /** 工具调用记录 */
  @Column({ name: 'tool_calls', type: 'jsonb', nullable: true })
  toolCalls?: unknown[];

  /** 结果：知识命中/未命中转人工/工具调用/权限拒绝 */
  @Column({ default: '知识命中' })
  result: string;

  @Column({ type: 'text', nullable: true })
  answer?: string;

  @Column({ name: 'trace_id', nullable: true })
  traceId?: string;

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  durationMs: number;

  /** 链路明细（对齐原型 audit-detail.html）：身份→权限→检索→判定各阶段耗时与结果 */
  @Column({ type: 'jsonb', nullable: true })
  stages?: Array<{ name: string; durationMs: number; result: string }>;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
