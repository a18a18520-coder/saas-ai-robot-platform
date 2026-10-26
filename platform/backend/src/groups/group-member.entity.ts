import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** 群成员（FR-005）：成员查看 + 群内角色覆盖（BR-007：群内角色 > 全局角色） */
@Entity('group_members')
@Unique(['groupId', 'channelUserId'])
export class GroupMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'group_id' })
  groupId: string;

  /** 渠道用户（企微 ID / 微信客户无 ID 用昵称） */
  @Column({ name: 'channel_user_id' })
  channelUserId: string;

  /** 来源渠道；wx_customer 表示企微客户群中的外部联系人。 */
  @Column({ default: 'wecom' })
  source: 'wecom' | 'wx_customer' | 'dingtalk' | 'feishu';

  /** 关联平台用户（手机号合并后） */
  @Column({ name: 'user_id', nullable: true })
  userId?: string;

  /** 群内角色覆盖（跟随默认=null）——BR-007 */
  @Column({ name: 'group_role_override', nullable: true })
  groupRoleOverride?: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
