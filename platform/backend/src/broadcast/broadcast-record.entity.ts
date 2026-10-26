import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 消息群发记录（FR-017）：多选机器人→选群→发送→记录/重试 */
@Entity('broadcast_records')
export class BroadcastRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  /** 多选机器人 ID 列表 */
  @Column({ name: 'robot_ids', type: 'jsonb' })
  robotIds: string[];

  /** 目标群 chat_id 列表 */
  @Column({ name: 'group_ids', type: 'jsonb' })
  groupIds: string[];

  @Column({ type: 'text' })
  content: string;

  /** 图片列表（base64/URL） */
  @Column({ type: 'jsonb', nullable: true })
  images?: string[];

  @Column({ default: 'PENDING' })
  status: 'PENDING' | 'SENDING' | 'SCHEDULED' | 'SUCCESS' | 'PARTIAL' | 'FAILED';

  /** 逐群结果：{chat_id: ok/error} */
  @Column({ name: 'results', type: 'jsonb', nullable: true })
  results?: Record<string, string>;

  @Column({ name: 'operator', nullable: true })
  operator?: string;

  /** 每轮之间的间隔；首轮在创建后立即执行。 */
  @Column({ name: 'poll_interval_minutes', type: 'integer', default: 5 })
  pollIntervalMinutes: number;

  /** 计划执行的总轮数（包含创建后立即执行的首轮）。 */
  @Column({ name: 'poll_count', type: 'integer', default: 1 })
  pollCount: number;

  @Column({ name: 'completed_polls', type: 'integer', default: 0 })
  completedPolls: number;

  @Column({ name: 'next_poll_at', type: 'timestamptz', nullable: true })
  nextPollAt?: Date | null;

  @Column({ name: 'last_sent_at', type: 'timestamptz', nullable: true })
  lastSentAt?: Date | null;

  /** 每轮逐群结果，保留历史以便排查重复发送和渠道失败。 */
  @Column({ name: 'round_results', type: 'jsonb', nullable: true })
  roundResults?: Array<{
    round: number;
    sentAt: string;
    results: Record<string, string>;
    attempts: Record<string, number>;
  }>;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
