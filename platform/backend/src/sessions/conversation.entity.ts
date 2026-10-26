import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 五层会话模型（FR-014）：tenant/robot/group/user/conversation，群内按 user 隔离 */
@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'robot_id' })
  robotId: string;

  @Column({ name: 'group_id', nullable: true })
  groupId?: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ default: '' }) channel: string;
  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true }) endedAt?: Date;
  @Column({ type: 'text', default: '' }) summary: string;
  @Column({ name: 'tool_state', type: 'jsonb', nullable: true }) toolState?: Record<string, unknown> | null;
  @Column({ name: 'summary_through_id', nullable: true }) summaryThroughId?: string;

  /** 群上下文：仅存该用户相关（BR-004 防污染） */
  @Column({ name: 'context_ref', nullable: true })
  contextRef?: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}

/** 消息记录 */
@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'conversation_id' })
  conversationId: string;

  @Column({ default: 'user' })
  role: 'user' | 'assistant' | 'human' | 'system';

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
