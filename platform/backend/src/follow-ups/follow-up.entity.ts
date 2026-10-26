import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 转人工待跟进队列（FR-016）：AI 未命中知识库的问题进入队列，运营跟进处理 */
@Entity('follow_ups')
export class FollowUp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'robot_id', nullable: true })
  robotId?: string;

  /** 来源渠道（wecom/dingtalk/feishu/web） */
  @Column({ default: 'web' })
  channel: string;

  @Column({ name: 'chat_id', nullable: true })
  chatId?: string;

  @Column({ name: 'channel_user_id' })
  channelUserId: string;

  @Column({ type: 'text' })
  question: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  delivery: { channelId?: string; conversationId?: string; mentionUserIds?: string[]; handoff?: string; state?: 'sending' | 'sent' | 'failed' | 'uncertain'; attemptId?: string; startedAt?: string; answerHash?: string; sentAt?: string; error?: string; actorId?: string };

  /** pending 待跟进 / followed 已跟进 / closed 已关闭 */
  @Column({ default: 'pending' })
  status: 'pending' | 'followed' | 'closed';

  @Column({ type: 'text', nullable: true })
  note?: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  resolution: { answer?: string; answeredBy?: string; answeredAt?: string; datasetId?: string; jobId?: string; secLevel?: number; saveToKnowledge?: boolean; importRevision?: number; importedHash?: string };

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
