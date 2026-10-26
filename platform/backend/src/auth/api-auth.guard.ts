import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthPayload, AuthService } from './auth.service';
import { RolesService } from '../roles/roles.service';

const WINDOW_BY_RESOURCE: Record<string, string> = {
  stats: 'dashboard',
  notifications: 'notifications',
  robots: 'robots',
  models: 'robots',
  wiki: 'knowledge',
  evaluations: 'robots',
  channels: 'channels',
  tools: 'tools',
  dify: 'robots',
  groups: 'groups',
  broadcast: 'broadcast',
  messages: 'messages',
  collector: 'messages',
  'follow-ups': 'follow-ups',
  sessions: 'sessions',
  audit: 'audit',
  logs: 'logs',
  knowledge: 'knowledge',
  'knowledge-base': 'knowledge',
  users: 'users',
  roles: 'roles',
  accounts: 'settings',
  profile: 'settings',
  payments: 'settings',
};

/** 平台窗口与 API 边界的服务端映射；未知路由对普通平台账号默认拒绝。 */
function platformPermissions(path: string, method: string): string[] {
  if (path.startsWith('/api/v1/admin/platform/')) return [];
  if (path.startsWith('/api/v1/admin/stats')) return ['dashboard', 'stats'];
  if (path.startsWith('/api/v1/admin/tenants')) {
    return method === 'GET'
      ? ['tenants', 'audit', 'dify', 'tools']
      : ['tenants'];
  }
  if (path.startsWith('/api/v1/admin/plans')) {
    return method === 'GET' ? ['plans', 'tenants', 'payments'] : ['plans'];
  }
  if (path.startsWith('/api/v1/admin/payments')) return ['payments'];
  if (path.startsWith('/api/v1/admin/models')) return ['settings'];
  if (path.startsWith('/api/v1/admin/dify')) return ['dify'];
  if (path.startsWith('/api/v1/admin/audit')) return ['audit'];
  if (path.startsWith('/api/v1/admin/tools')) return ['tools'];
  if (path.startsWith('/api/v1/admin/content-filter')) return ['filter'];
  if (path.startsWith('/api/v1/platform/notifications'))
    return ['notifications'];
  if (path.startsWith('/api/v1/platform/settings')) return ['settings'];
  return [];
}

/** 全局 API 鉴权：校验 JWT、平台/租户域、租户边界和租户窗口权限。 */
@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly roles: RolesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { auth?: AuthPayload; tenantContext?: unknown }>();
    const path = req.path;
    if (
      !path.startsWith('/api/v1/') ||
      path.startsWith('/api/v1/public/') ||
      path.startsWith('/api/v1/platform/auth/')
    )
      return true;

    const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token)
      throw new UnauthorizedException({
        code: 40101,
        message: '未登录或访问令牌缺失',
        data: null,
      });
    const payload = this.auth.verifyAccessToken(token);
    const tenantApi = path.startsWith('/api/v1/tenant/');
    const platformApi =
      path.startsWith('/api/v1/admin/') || path.startsWith('/api/v1/platform/');
    if (
      (tenantApi && payload.domain !== 'tenant') ||
      (platformApi && payload.domain !== 'platform')
    ) {
      throw new ForbiddenException({
        code: 40301,
        message: '认证域无权访问该接口',
        data: null,
      });
    }

    if (platformApi && payload.role !== 'SUPER_ADMIN') {
      const required = platformPermissions(path, req.method ?? 'GET');
      if (
        required.length === 0 ||
        !required.some((permission) =>
          payload.permissions?.includes(permission),
        )
      ) {
        throw new ForbiddenException({
          code: 40301,
          message: '当前平台角色没有该功能权限',
          data: null,
        });
      }
    }

    if (tenantApi) {
      if (!payload.tenantId) {
        throw new ForbiddenException({
          code: 40301,
          message: '租户身份缺少租户边界',
          data: null,
        });
      }
      const access = await this.roles.accountAccess(
        payload.sub,
        payload.tenantId,
      );
      if (!access) {
        throw new UnauthorizedException({
          code: 40102,
          message: '账号已禁用或关联角色已失效，请重新登录',
          data: null,
        });
      }
      if (
        (payload.sessionVersion ?? 0) !== (access.account.sessionVersion ?? 0)
      ) {
        throw new UnauthorizedException({
          code: 40102,
          message: '账号凭据已变更，请重新登录',
          data: null,
        });
      }
      if (
        payload.roleId !== access.roleId ||
        payload.role !== access.authority ||
        !this.samePermissions(payload.windows, access.windows)
      ) {
        throw new UnauthorizedException({
          code: 40102,
          message: '账号角色权限已更新，正在刷新登录状态',
          data: null,
        });
      }
      payload.roleId = access.roleId;
      payload.roleName = access.roleName;
      payload.windows = access.windows;
      payload.mustChangePassword = access.account.mustChangePassword;
      const initialPasswordPath = '/api/v1/tenant/accounts/initial-password';
      if (
        payload.mustChangePassword &&
        !(path === initialPasswordPath && req.method === 'POST')
      ) {
        throw new ForbiddenException({
          code: 40302,
          message: '使用临时初始密码登录后，必须先设置新密码',
          data: { mustChangePassword: true },
        });
      }
      const requestedTenantIds = [
        (req.params as any)?.tenantId,
        (req.query as any)?.tenantId,
        (req.body as any)?.tenantId,
      ]
        .filter(
          (value) => value !== undefined && value !== null && value !== '',
        )
        .map(String);
      if (
        requestedTenantIds.some((tenantId) => tenantId !== payload.tenantId)
      ) {
        throw new ForbiddenException({
          code: 40301,
          message: '禁止访问其他租户数据',
          data: null,
        });
      }
      // 服务端以已验签令牌为唯一租户来源；即使调用方省略 tenantId，也不会让 ORM 忽略边界条件。
      (req.query as Record<string, unknown>).tenantId = payload.tenantId;
      if (
        req.body &&
        typeof req.body === 'object' &&
        !Buffer.isBuffer(req.body) &&
        !Array.isArray(req.body)
      ) {
        (req.body as Record<string, unknown>).tenantId = payload.tenantId;
      }
      const resource = path.slice('/api/v1/tenant/'.length).split('/')[0];
      const requiredWindow = WINDOW_BY_RESOURCE[resource];
      if (
        requiredWindow &&
        payload.windows &&
        !payload.windows.includes(requiredWindow)
      ) {
        throw new ForbiddenException({
          code: 40301,
          message: '当前账号没有该功能窗口权限',
          data: null,
        });
      }
      req.tenantContext = {
        tenantId: payload.tenantId,
        role: payload.role,
        accountId: payload.sub,
      };
    }
    req.auth = payload;
    return true;
  }

  private samePermissions(
    tokenPermissions: string[] | undefined,
    currentPermissions: string[],
  ): boolean {
    const token = [...new Set(tokenPermissions ?? [])].sort();
    const current = [...new Set(currentPermissions)].sort();
    return (
      token.length === current.length &&
      token.every((permission, index) => permission === current[index])
    );
  }
}
