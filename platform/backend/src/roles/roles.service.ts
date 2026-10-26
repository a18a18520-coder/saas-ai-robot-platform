import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Repository } from 'typeorm';
import { Role, RolePermission, Dept, DeptKb } from './role.entity';
import { TenantAccount } from '../tenants/tenant-account.entity';
import { KnowledgeBase } from '../knowledge/knowledge-base.entity';
import {
  BUILTIN_TENANT_ROLE_WINDOWS,
  TENANT_ADMIN_WINDOWS,
  TENANT_WINDOW_PERMISSIONS,
} from '../tenants/tenant-account.defaults';

export type TenantRoleAuthority = 'TENANT_ADMIN' | 'TENANT_OP';

export interface TenantRoleView extends Role {
  windowPermissions: string[];
  accountCount: number;
}

export interface TenantAccountAccess {
  account: TenantAccount;
  roleId?: string;
  roleName: string;
  authority: TenantRoleAuthority;
  windows: string[];
}

/** 角色/部门权限服务（FR-008/FR-010 表驱动） */
@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly perms: Repository<RolePermission>,
    @InjectRepository(Dept) private readonly depts: Repository<Dept>,
    @InjectRepository(DeptKb) private readonly deptKbs: Repository<DeptKb>,
    @InjectRepository(TenantAccount)
    private readonly accounts: Repository<TenantAccount>,
    @InjectRepository(KnowledgeBase)
    private readonly knowledgeBases: Repository<KnowledgeBase>,
  ) {}

  /** 角色列表同时返回后台功能权限和已绑定管理账号数。 */
  async listRoles(tenantId: string): Promise<TenantRoleView[]> {
    const roles = await this.roles.find({
      where: { tenantId },
      order: { isBuiltin: 'DESC', createdAt: 'ASC' },
    });
    if (!roles.length) return [];
    const roleIds = roles.map((role) => role.id);
    const [permissions, accounts] = await Promise.all([
      this.perms.find({
        where: { roleId: In(roleIds), resourceType: 'window' },
      }),
      this.accounts.find({ where: { tenantId, roleId: In(roleIds) } }),
    ]);
    const windows = new Map<string, string[]>();
    const counts = new Map<string, number>();
    for (const permission of permissions) {
      const values = windows.get(permission.roleId) ?? [];
      values.push(permission.resourceId);
      windows.set(permission.roleId, values);
    }
    for (const account of accounts) {
      if (account.roleId)
        counts.set(account.roleId, (counts.get(account.roleId) ?? 0) + 1);
    }
    return roles.map((role) => ({
      ...role,
      windowPermissions: windows.get(role.id) ?? [],
      accountCount: counts.get(role.id) ?? 0,
    }));
  }

  async listAssignableRoles(tenantId: string): Promise<TenantRoleView[]> {
    return (await this.listRoles(tenantId)).filter(
      (role) => role.status === 'ACTIVE',
    );
  }

  /** 新建角色（可从同租户现有角色复制全部权限）。 */
  async createRole(
    tenantId: string,
    rawName: string,
    copyFromId?: string,
  ): Promise<Role> {
    const name = rawName?.trim();
    if (!name) throw new BadRequestException('角色名称必填');
    const duplicate = await this.roles.findOne({
      where: { tenantId, name: ILike(name) },
    });
    if (duplicate) throw new ConflictException('角色名称已存在');
    let sourcePermissions: RolePermission[] = [];
    if (copyFromId) {
      await this.findRoleForTenant(tenantId, copyFromId);
      sourcePermissions = await this.perms.find({
        where: { roleId: copyFromId },
      });
    }
    const role = await this.roles.save(
      this.roles.create({ tenantId, name, status: 'ACTIVE' }),
    );
    for (const permission of sourcePermissions) {
      await this.perms.save(
        this.perms.create({
          roleId: role.id,
          resourceType: permission.resourceType,
          resourceId: permission.resourceId,
        }),
      );
    }
    return role;
  }

  /** 角色权限矩阵（后台功能/知识库/工具/机器人）。 */
  async getRolePerms(
    tenantId: string,
    roleId: string,
  ): Promise<Record<string, string[]>> {
    await this.findRoleForTenant(tenantId, roleId);
    const permissions = await this.perms.find({ where: { roleId } });
    const byType: Record<string, string[]> = {
      window: [],
      kb: [],
      tool: [],
      robot: [],
    };
    for (const permission of permissions)
      (byType[permission.resourceType] ??= []).push(permission.resourceId);
    // 旧版本前端曾把本地 knowledge_bases.id 写入权限表；API 始终返回
    // Dify datasetId，使权限矩阵、机器人候选池和检索链路使用同一标识。
    byType.kb = await this.canonicalKnowledgeIds(tenantId, byType.kb);
    return byType;
  }

  /** 设置角色权限；内置管理员的后台功能权限固定为全部。 */
  async setRolePerms(
    tenantId: string,
    roleId: string,
    resourceType: 'window' | 'kb' | 'tool' | 'robot',
    resourceIds: string[],
  ): Promise<void> {
    const role = await this.findRoleForTenant(tenantId, roleId);
    let normalized = this.normalizeResources(resourceType, resourceIds);
    if (resourceType === 'kb') {
      normalized = await this.validateKnowledgeIds(tenantId, normalized);
    }
    if (
      resourceType === 'window' &&
      role.isBuiltin &&
      role.name === '管理员' &&
      !this.sameValues(normalized, TENANT_ADMIN_WINDOWS)
    ) {
      throw new UnprocessableEntityException(
        '内置管理员必须保留全部后台功能权限',
      );
    }
    await this.perms.delete({ roleId, resourceType });
    for (const resourceId of normalized) {
      await this.perms.save(
        this.perms.create({ roleId, resourceType, resourceId }),
      );
    }
  }

  async removeRole(tenantId: string, roleId: string): Promise<void> {
    const role = await this.findRoleForTenant(tenantId, roleId);
    if (role.isBuiltin)
      throw new UnprocessableEntityException('内置角色不可删除');
    if ((await this.accounts.count({ where: { tenantId, roleId } })) > 0) {
      throw new ConflictException('该角色仍有管理账号在使用，请先调整账号角色');
    }
    await this.perms.delete({ roleId });
    await this.roles.delete(roleId);
  }

  async roleAssignment(
    tenantId: string,
    roleId: string,
  ): Promise<{
    role: Role;
    authority: TenantRoleAuthority;
    windows: string[];
  }> {
    const role = await this.findRoleForTenant(tenantId, roleId);
    if (role.status !== 'ACTIVE')
      throw new UnprocessableEntityException('该角色已禁用，不能分配给账号');
    return {
      role,
      authority: this.authorityForRole(role),
      windows: await this.windowPermissionsOf(role.id),
    };
  }

  /** 每次鉴权按账号当前角色解析权限，避免旧令牌绕过最新配置。 */
  async accountAccess(
    accountId: string,
    tenantId: string,
  ): Promise<TenantAccountAccess | null> {
    const account = await this.accounts.findOne({
      where: { id: accountId, tenantId, status: 'ACTIVE' },
    });
    return account ? this.accessForAccount(account) : null;
  }

  async accessForAccount(
    account: TenantAccount,
  ): Promise<TenantAccountAccess | null> {
    if (!account.roleId) {
      return {
        account,
        roleName:
          account.role === 'TENANT_ADMIN' ? '管理员（兼容）' : '运营（兼容）',
        authority:
          account.role === 'TENANT_ADMIN' ? 'TENANT_ADMIN' : 'TENANT_OP',
        windows:
          account.role === 'TENANT_ADMIN'
            ? [...TENANT_ADMIN_WINDOWS]
            : [...(account.windows ?? [])],
      };
    }
    const role = await this.roles.findOne({
      where: {
        id: account.roleId,
        tenantId: account.tenantId,
        status: 'ACTIVE',
      },
    });
    if (!role) return null;
    return {
      account,
      roleId: role.id,
      roleName: role.name,
      authority: this.authorityForRole(role),
      windows: await this.windowPermissionsOf(role.id),
    };
  }

  /** 管理账号列表使用同一解析逻辑，但角色失效时仍保留可诊断信息。 */
  async accountView(account: TenantAccount): Promise<{
    roleId?: string;
    roleName: string;
    windows: string[];
    roleAvailable: boolean;
  }> {
    const access = await this.accessForAccount(account);
    if (access) {
      return {
        roleId: access.roleId,
        roleName: access.roleName,
        windows: access.windows,
        roleAvailable: true,
      };
    }
    const role = account.roleId
      ? await this.roles.findOne({
          where: { id: account.roleId, tenantId: account.tenantId },
        })
      : null;
    return {
      roleId: account.roleId,
      roleName: role?.name ?? '角色已失效',
      windows: [],
      roleAvailable: false,
    };
  }

  /** 部门管理 */
  async listDepts(tenantId: string): Promise<Dept[]> {
    return this.depts.find({ where: { tenantId } });
  }

  async createDept(tenantId: string, name: string): Promise<Dept> {
    return this.depts.save(this.depts.create({ tenantId, name }));
  }

  async getDeptKbs(tenantId: string, deptId: string): Promise<string[]> {
    const dept = await this.findDeptForTenant(tenantId, deptId);
    const stored = (await this.deptKbs.find({ where: { deptId: dept.id } })).map(
      (department) => department.knowledgeId,
    );
    return this.canonicalKnowledgeIds(tenantId, stored);
  }

  async setDeptKbs(
    tenantId: string,
    deptId: string,
    knowledgeIds: string[],
  ): Promise<void> {
    const dept = await this.findDeptForTenant(tenantId, deptId);
    const canonical = await this.validateKnowledgeIds(tenantId, knowledgeIds);
    await this.deptKbs.delete({ deptId: dept.id });
    for (const knowledgeId of canonical) {
      await this.deptKbs.save(
        this.deptKbs.create({ deptId: dept.id, knowledgeId }),
      );
    }
  }

  async removeDept(tenantId: string, deptId: string): Promise<void> {
    const dept = await this.findDeptForTenant(tenantId, deptId);
    await this.deptKbs.delete({ deptId: dept.id });
    await this.depts.delete(dept.id);
  }

  async findRoleByName(tenantId: string, name: string): Promise<Role | null> {
    return this.roles.findOne({
      where: { tenantId, name, status: 'ACTIVE' },
    });
  }

  /** 内置角色播种（幂等）；仅新建角色时写入默认后台权限。 */
  async ensureBuiltinRoles(tenantId: string): Promise<void> {
    for (const [name, windows] of Object.entries(BUILTIN_TENANT_ROLE_WINDOWS)) {
      let role = await this.roles.findOne({ where: { tenantId, name } });
      if (role) continue;
      role = await this.roles.save(
        this.roles.create({
          tenantId,
          name,
          isBuiltin: true,
          status: 'ACTIVE',
        }),
      );
      for (const resourceId of windows) {
        await this.perms.save(
          this.perms.create({
            roleId: role.id,
            resourceType: 'window',
            resourceId,
          }),
        );
      }
    }
  }

  /** 查角色权限（供 PermissionService 消费）。 */
  async kbWhitelistOf(roleId: string): Promise<string[]> {
    const role = await this.roles.findOne({ where: { id: roleId } });
    if (!role) return [];
    const permissions = await this.perms.find({
      where: { roleId, resourceType: 'kb' },
    });
    return this.canonicalKnowledgeIds(
      role.tenantId,
      permissions.map((permission) => permission.resourceId),
    );
  }

  /**
   * 在角色白名单之上应用知识库可见性。全部门知识库无需额外部门勾选；
   * 限定知识库必须命中 knowledge_bases.dept_ids 或兼容的 dept_kbs 矩阵。
   */
  async filterKnowledgeForDepartment(
    tenantId: string,
    departmentId: string | undefined,
    knowledgeIds: string[],
  ): Promise<string[]> {
    const canonical = await this.canonicalKnowledgeIds(tenantId, knowledgeIds);
    if (!canonical.length) return [];
    const knowledgeBases = await this.knowledgeBases.find({
      where: { tenantId },
    });
    const byDataset = new Map(
      knowledgeBases.map((kb) => [kb.datasetId, kb] as const),
    );
    const departmentKnowledge = departmentId
      ? new Set(await this.getDeptKbs(tenantId, departmentId))
      : new Set<string>();

    return canonical.filter((datasetId) => {
      const kb = byDataset.get(datasetId);
      if (!kb) return false;
      if (kb.visibility === 'all') return true;
      return Boolean(
        departmentId &&
          ((kb.deptIds ?? []).includes(departmentId) ||
            departmentKnowledge.has(datasetId)),
      );
    });
  }

  async toolWhitelistOf(roleId: string): Promise<string[]> {
    const permissions = await this.perms.find({
      where: { roleId, resourceType: 'tool' },
    });
    return permissions.map((permission) => permission.resourceId);
  }

  async windowPermissionsOf(roleId: string): Promise<string[]> {
    const permissions = await this.perms.find({
      where: { roleId, resourceType: 'window' },
    });
    const allowed = new Set<string>(TENANT_WINDOW_PERMISSIONS);
    return permissions
      .map((permission) => permission.resourceId)
      .filter((permission) => allowed.has(permission));
  }

  private findRoleForTenant(tenantId: string, id: string): Promise<Role> {
    return this.roles.findOne({ where: { id, tenantId } }).then((role) => {
      if (!role) throw new NotFoundException('租户角色不存在');
      return role;
    });
  }

  private findDeptForTenant(tenantId: string, id: string): Promise<Dept> {
    return this.depts.findOne({ where: { id, tenantId } }).then((dept) => {
      if (!dept) throw new NotFoundException('租户部门不存在');
      return dept;
    });
  }

  /** 接受新 datasetId 和旧本地 ID，统一转换为 Dify datasetId。 */
  private async canonicalKnowledgeIds(
    tenantId: string,
    values: string[],
  ): Promise<string[]> {
    const unique = [...new Set((values ?? []).map(String).filter(Boolean))];
    if (!unique.length) return [];
    const knowledgeBases = await this.knowledgeBases.find({
      where: { tenantId },
    });
    const canonical = new Map<string, string>();
    for (const kb of knowledgeBases) {
      canonical.set(kb.id, kb.datasetId);
      canonical.set(kb.datasetId, kb.datasetId);
    }
    return [
      ...new Set(
        unique
          .map((value) => canonical.get(value))
          .filter((value): value is string => Boolean(value)),
      ),
    ];
  }

  private async validateKnowledgeIds(
    tenantId: string,
    values: string[],
  ): Promise<string[]> {
    const unique = [...new Set((values ?? []).map(String).filter(Boolean))];
    const canonical = await this.canonicalKnowledgeIds(tenantId, unique);
    if (canonical.length !== unique.length) {
      throw new BadRequestException('知识库不存在或不属于当前租户');
    }
    return canonical;
  }

  private authorityForRole(role: Role): TenantRoleAuthority {
    return role.isBuiltin && role.name === '管理员'
      ? 'TENANT_ADMIN'
      : 'TENANT_OP';
  }

  private normalizeResources(
    resourceType: 'window' | 'kb' | 'tool' | 'robot',
    values: string[],
  ): string[] {
    const unique = [...new Set((values ?? []).map(String).filter(Boolean))];
    if (resourceType !== 'window') return unique;
    const allowed = new Set<string>(TENANT_WINDOW_PERMISSIONS);
    const invalid = unique.filter((value) => !allowed.has(value));
    if (invalid.length)
      throw new BadRequestException(`未知后台功能权限：${invalid.join('、')}`);
    return unique;
  }

  private sameValues(left: string[], right: readonly string[]): boolean {
    const expected = new Set<string>(right);
    return (
      left.length === right.length && left.every((value) => expected.has(value))
    );
  }
}
