import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** 群（FR-005）——机器人拉入自动注册，群类型：内部群/客户群 */
@Entity('groups')
@Unique(['tenantId', 'channel', 'chatId'])
export class Group {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  /** 厂商群 ID；同租户同渠道内唯一。 */
  @Column({ name: 'chat_id' })
  chatId: string;

  @Column({ nullable: true })
  name?: string;

  /** internal 内部群 / customer 客户群（含微信用户，V2） */
  @Column({ name: 'group_type', default: 'internal' })
  groupType: 'internal' | 'customer';

  /** 归属机器人（一群一机器人） */
  @Column({ name: 'robot_id', nullable: true })
  robotId?: string;

  /** 待确认=未绑定机器人，消息不处理 */
  @Column({ default: 'PENDING' })
  status: 'PENDING' | 'BOUND' | 'DISABLED';

  /** 转人工客服角色 */
  @Column({ name: 'handoff_role', nullable: true })
  handoffRole?: string;

  /** 来源渠道（wecom/dingtalk/feishu/web）——群发按此分发真实发送 */
  @Column({ default: 'wecom' })
  channel: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
