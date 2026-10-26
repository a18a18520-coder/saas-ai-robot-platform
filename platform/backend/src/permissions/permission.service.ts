import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { RolesService } from '../roles/roles.service';

/**
 * 权限引擎（FR-008 × FR-010）——表驱动三维计算：
 *   可检索范围 = 角色知识白名单(role_permissions) ∩ 部门知识范围(dept_kbs) ∩ 文件密级
 *   群内角色覆盖 > 全局角色（BR-007）
 */
export interface PermissionResult {
  roles: string[];
  kbWhitelist: string[];   // 可检索平台知识库（Dify dataset UUID）列表
  toolWhitelist: string[]; // 可调用工具标识
}

@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);
  /** 内置权限角色（播种集合；自定义角色/群内角色名不在其内） */
  private static readonly BUILTIN = ['游客', '用户', '客服', '运营', '管理员'];
  /** warn 节流：同一 tenant+角色名 只告警一次，避免热路径刷日志 */
  private readonly warned = new Set<string>();

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly roles: RolesService,
  ) {}

  /** 计算用户权限（同机器人不同人不同范围的核心，真实矩阵查询） */
  async compute(params: { tenantId: string; user: User; groupRole?: string }): Promise<PermissionResult> {
    // 全局角色 = 手动指派的 user.role 优先，否则按身份派生（员工+客服角色并存语义）
    const globalRole = params.user.role ?? this.roleOf(params.user);
    // BR-007: 群内角色覆盖 > 全局角色
    const roleName = params.groupRole && params.groupRole !== '跟随默认' ? params.groupRole : globalRole;

    // 查角色记录；miss 时：内置名 → 播种后重查；自定义/群内名 → 节流 warn + 回退游客（不收紧不静默）
    let role = await this.roles.findRoleByName(params.tenantId, roleName);
    if (!role) {
      if (PermissionService.BUILTIN.includes(roleName)) {
        await this.roles.ensureBuiltinRoles(params.tenantId);
        role = await this.roles.findRoleByName(params.tenantId, roleName);
      }
      if (!role) {
        const key = `${params.tenantId}:${roleName}`;
        if (!this.warned.has(key)) {
          this.warned.add(key);
          this.logger.warn(`tenant=${params.tenantId} 角色「${roleName}」不存在（非内置或未指派），回退游客权限（user=${params.user.id}）`);
        }
        role = await this.roles.findRoleByName(params.tenantId, '游客');
      }
    }
    if (!role) {
      // 游客行也缺失（新租户刚开通）：播种后取游客兜底
      await this.roles.ensureBuiltinRoles(params.tenantId);
      role = await this.roles.findRoleByName(params.tenantId, '游客');
    }

    // 角色知识白名单 + 工具白名单（表驱动）
    let kbWhitelist = role ? await this.roles.kbWhitelistOf(role.id) : [];
    const toolWhitelist = role ? await this.roles.toolWhitelistOf(role.id) : [];

    // 叠加知识库可见性（BR-008）：全部门知识库直接通过；限定知识库
    // 必须命中当前用户部门。无部门身份不会获得限定知识库权限。
    const dept = params.user.department
      ? await this.roles
          .listDepts(params.tenantId)
          .then((ds) => ds.find((item) => item.name === params.user.department))
      : undefined;
    kbWhitelist = await this.roles.filterKnowledgeForDepartment(
      params.tenantId,
      dept?.id,
      kbWhitelist,
    );

    return { roles: [roleName], kbWhitelist, toolWhitelist };
  }

  /** 身份 → 默认角色名映射（员工无默认权限角色：部门知识交集在下方特判，未指派角色时按普通用户） */
  private roleOf(user: User): string {
    const map: Record<string, string> = { '游客': '游客', '用户': '用户', '客服': '客服', '运营': '运营', '管理员': '管理员', '员工': '用户' };
    return map[user.identity] ?? '用户';
  }
}
