import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 渠道（FR-004）：统一 Channel 抽象——企微/钉钉/飞书/Web 聊天 */
@Entity('channels')
export class Channel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  /** wecom 企业微信 / dingtalk 钉钉 / feishu 飞书 / web Web聊天 */
  @Column()
  type: 'wecom' | 'dingtalk' | 'feishu' | 'web';

  @Column()
  name: string;

  /** 渠道凭据配置；接口展示时不得回传敏感值。 */
  @Column({ type: 'jsonb' })
  config: Record<string, string>;

  /** 已连接 / 未连接 / 配置中 */
  @Column({ default: 'disconnected' })
  status: 'connected' | 'disconnected' | 'pending';

  /** 绑定的机器人（该渠道服务的机器人） */
  @Column({ name: 'bind_robot_id', nullable: true })
  bindRobotId?: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
