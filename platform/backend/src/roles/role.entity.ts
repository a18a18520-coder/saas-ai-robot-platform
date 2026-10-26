import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 角色（FR-008 RBAC）——内置 + 自定义，生命周期四态 */
@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column()
  name: string;

  @Column({ name: 'is_builtin', default: false })
  isBuiltin: boolean;

  @Column({ default: 'ACTIVE' })
  status: 'ACTIVE' | 'DISABLED';

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}

/** 角色权限（RBAC 矩阵：角色 × 资源） */
@Entity('role_permissions')
export class RolePermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'role_id' })
  roleId: string;

  /** kb 知识库 / tool 工具 / robot 机器人 / window 租户后台功能 */
  @Column({ name: 'resource_type' })
  resourceType: 'kb' | 'tool' | 'robot' | 'window';

  /** 资源 ID：知识库 dataset UUID / 工具标识 / 机器人 ID */
  @Column({ name: 'resource_id' })
  resourceId: string;
}

/** 部门（FR-010 部门知识权限 BR-008） */
@Entity('depts')
export class Dept {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column()
  name: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}

/** 部门 × 知识库（部门可访问知识） */
@Entity('dept_kbs')
export class DeptKb {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dept_id' })
  deptId: string;

  @Column({ name: 'knowledge_id' })
  knowledgeId: string;
}
