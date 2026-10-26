import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** 租户管理人员账号（settings.html 管理人员 Tab；真实化 tenant/login） */
@Entity('tenant_accounts')
@Unique(['account'])
export class TenantAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  /** 姓名（展示） */
  @Column()
  name: string;

  /** 登录账号（邮箱，全局唯一） */
  @Column()
  account: string;

  /** scrypt 哈希（盐内嵌 N:r:p$salt$hash） */
  @Column({ name: 'password_hash' })
  passwordHash: string;

  /** 角色：TENANT_ADMIN 管理员 / TENANT_OPS 运营（权限边界） */
  @Column({ default: 'TENANT_OPS' })
  role: 'TENANT_ADMIN' | 'TENANT_OPS';

  /** 关联租户角色；角色权限是后台功能访问的权威来源。 */
  @Column({ name: 'role_id', type: 'uuid', nullable: true })
  roleId?: string;

  /** 兼容旧数据的权限快照；实时鉴权以 role_permissions 为准。 */
  @Column({ name: 'windows', type: 'jsonb', default: () => `'[]'` })
  windows: string[];

  /** ACTIVE 可登录 / DISABLED 禁用 */
  @Column({ default: 'ACTIVE' })
  status: 'ACTIVE' | 'DISABLED';

  /** 密码重置时递增，使旧 Refresh Token 无法续期。 */
  @Column({ name: 'session_version', type: 'int', default: 0 })
  sessionVersion: number;

  /** 临时初始密码登录后，未完成改密前不得访问业务窗口。 */
  @Column({ name: 'must_change_password', default: false })
  mustChangePassword: boolean;

  /** 密码最近一次设置时间，用于租户密码有效期策略。 */
  @Column({ name: 'password_changed_at', type: 'timestamptz', nullable: true })
  passwordChangedAt?: Date;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt?: Date;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}

/** 登录日志（settings.html 安全设置：时间/账号/IP/结果） */
@Entity('login_logs')
export class LoginLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', nullable: true })
  tenantId?: string;

  @Column()
  account: string;

  /** 登录域：tenant 租户侧 / platform 平台侧 */
  @Column({ default: 'tenant' })
  domain: 'tenant' | 'platform';

  @Column({ default: '0.0.0.0' })
  ip: string;

  @Column({ default: '失败' })
  result: '成功' | '失败';

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}
