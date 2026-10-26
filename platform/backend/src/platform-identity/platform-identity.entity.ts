import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

export const PLATFORM_PERMISSION_KEYS = [
  'dashboard',
  'notifications',
  'tenants',
  'plans',
  'payments',
  'dify',
  'audit',
  'stats',
  'tools',
  'filter',
  'settings',
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSION_KEYS)[number];

/** 平台角色：超管隐式拥有全权，其他角色按管理窗口授权。 */
@Entity('platform_roles')
@Unique(['code'])
@Unique(['name'])
export class PlatformRole {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 稳定内部标识，不随展示名称变更。 */
  @Column()
  code: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  permissions: PlatformPermission[];

  @Column({ name: 'is_super_admin', default: false })
  isSuperAdmin: boolean;

  @Column({ name: 'is_builtin', default: false })
  isBuiltin: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}

/** 平台管理账号，与租户账号分库分域认证。 */
@Entity('platform_accounts')
@Unique(['account'])
@Index('UQ_platform_builtin_account', ['isBuiltin'], {
  unique: true,
  where: '"is_builtin" = true',
})
export class PlatformAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  account: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @Column({ default: 'ACTIVE' })
  status: 'ACTIVE' | 'DISABLED';

  /** 部署内置超管：不可禁用、降级或删除。 */
  @Column({ name: 'is_builtin', default: false })
  isBuiltin: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt?: Date;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
