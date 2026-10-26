import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** 用户（FR-006）——手机号=系统唯一身份（BR-009），跨渠道映射 */
@Entity('users')
@Unique(['tenantId', 'phoneHash'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  /** 手机号不可逆指纹（租户内唯一身份主键）。 */
  @Column({ name: 'phone_hash', nullable: true })
  phoneHash?: string;

  /** 脱敏手机号（138****6688，列表/导出展示用——sha256 不可逆无法还原明文） */
  @Column({ name: 'phone_masked', nullable: true })
  phoneMasked?: string;

  @Column({ nullable: true })
  name?: string;

  /** 员工（企业人员库）/ 用户 / 客服 / 运营 / 管理员 / 游客 */
  @Column({ default: '游客' })
  identity: string;

  /** 权限角色（角色列，独立于身份：张伟=员工身份 + 客服角色；空=未指派） */
  @Column({ nullable: true })
  role?: string;

  /** 部门（部门知识权限 BR-008） */
  @Column({ nullable: true })
  department?: string;

  @Column({ name: 'knowledge_clearance', default: 1 }) knowledgeClearance: number;

  @Column({ default: 'ACTIVE' })
  status: 'ACTIVE' | 'DISABLED' | 'MERGED';

  /** 合并到的主用户 ID（BR-009 手机号合并） */
  @Column({ name: 'merged_into_id', nullable: true })
  mergedIntoId?: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}

/** 渠道身份映射（User Identity Mapping：渠道用户 → 平台用户） */
@Entity('user_identities')
@Unique(['tenantId', 'channel', 'channelUserId'])
export class UserIdentity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'user_id' })
  userId: string;

  /** wecom / web / dingtalk */
  @Column()
  channel: string;

  @Column({ name: 'channel_user_id' })
  channelUserId: string;

  /** 身份可信度：高（企业匹配/手机号认证）/ 低（游客） */
  @Column({ default: '低' })
  confidence: '高' | '低';

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
