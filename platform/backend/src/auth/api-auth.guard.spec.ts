import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ApiAuthGuard } from './api-auth.guard';

const auth = { verifyAccessToken: jest.fn() };
const roles = { accountAccess: jest.fn() };
const context = (request: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as any;

describe('ApiAuthGuard', () => {
  const guard = new ApiAuthGuard(auth as any, roles as any);

  beforeEach(() => {
    jest.clearAllMocks();
    // 默认让数据库中的账号/角色状态与刚验签的令牌保持一致；各测试可单独覆盖。
    roles.accountAccess.mockImplementation(async () => {
      const payload = auth.verifyAccessToken.mock.results.at(-1)?.value ?? {};
      return {
        account: {
          id: payload.sub,
          tenantId: payload.tenantId,
          status: 'ACTIVE',
          sessionVersion: payload.sessionVersion ?? 0,
          mustChangePassword: payload.mustChangePassword ?? false,
        },
        roleId: payload.roleId,
        roleName: payload.roleName ?? '测试角色',
        authority: payload.role,
        windows: payload.windows ?? [],
      };
    });
  });

  it('允许公开聊天入口', async () => {
    await expect(
      guard.canActivate(context({ path: '/api/v1/public/chat', headers: {} })),
    ).resolves.toBe(true);
  });

  it('拒绝缺少访问令牌的业务 API', async () => {
    await expect(
      guard.canActivate(context({ path: '/api/v1/tenant/users', headers: {} })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('拒绝平台令牌访问租户 API', async () => {
    auth.verifyAccessToken.mockReturnValue({
      sub: 'p1',
      domain: 'platform',
      role: 'SUPER_ADMIN',
    });
    await expect(
      guard.canActivate(
        context({
          path: '/api/v1/tenant/users',
          headers: { authorization: 'Bearer token' },
          query: {},
          params: {},
          body: {},
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('普通平台账号只能访问角色授权的窗口', async () => {
    auth.verifyAccessToken.mockReturnValue({
      sub: 'p1',
      domain: 'platform',
      role: 'PLATFORM_OP',
      permissions: ['audit'],
    });
    await expect(
      guard.canActivate(
        context({
          path: '/api/v1/admin/audit',
          method: 'GET',
          headers: { authorization: 'Bearer token' },
          query: {},
          params: {},
          body: {},
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        context({
          path: '/api/v1/admin/payments',
          method: 'GET',
          headers: { authorization: 'Bearer token' },
          query: {},
          params: {},
          body: {},
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('普通平台账号无法访问账号角色管理 API', async () => {
    auth.verifyAccessToken.mockReturnValue({
      sub: 'p1',
      domain: 'platform',
      role: 'PLATFORM_OP',
      permissions: ['settings'],
    });
    await expect(
      guard.canActivate(
        context({
          path: '/api/v1/admin/platform/accounts',
          method: 'GET',
          headers: { authorization: 'Bearer token' },
          query: {},
          params: {},
          body: {},
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('租户密码重置仅允许拥有 tenants 窗口的平台账号', async () => {
    const request = {
      path: '/api/v1/admin/tenants/tenant-1/reset-admin-password',
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      query: {},
      params: {},
      body: { password: 'NewTenant2026' },
    };
    auth.verifyAccessToken.mockReturnValue({
      sub: 'p1',
      domain: 'platform',
      role: 'PLATFORM_OP',
      permissions: ['audit'],
    });
    await expect(guard.canActivate(context(request))).rejects.toThrow(
      ForbiddenException,
    );

    auth.verifyAccessToken.mockReturnValue({
      sub: 'p2',
      domain: 'platform',
      role: 'PLATFORM_OP',
      permissions: ['tenants'],
    });
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
  });

  it('拒绝请求其他 tenantId', async () => {
    auth.verifyAccessToken.mockReturnValue({
      sub: 'a1',
      domain: 'tenant',
      role: 'TENANT_ADMIN',
      tenantId: 't1',
      windows: [],
    });
    await expect(
      guard.canActivate(
        context({
          path: '/api/v1/tenant/users',
          headers: { authorization: 'Bearer token' },
          query: { tenantId: 't2' },
          params: {},
          body: {},
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('同时校验 query 与 body，不能用合法 query 掩盖越权 body', async () => {
    auth.verifyAccessToken.mockReturnValue({
      sub: 'a1',
      domain: 'tenant',
      role: 'TENANT_ADMIN',
      tenantId: 't1',
      windows: [],
    });
    await expect(
      guard.canActivate(
        context({
          path: '/api/v1/tenant/channels',
          headers: { authorization: 'Bearer token' },
          query: { tenantId: 't1' },
          params: {},
          body: { tenantId: 't2' },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('调用方省略 tenantId 时从已验签令牌注入租户边界', async () => {
    auth.verifyAccessToken.mockReturnValue({
      sub: 'a1',
      domain: 'tenant',
      role: 'TENANT_ADMIN',
      tenantId: 't1',
      windows: ['users'],
    });
    const request = {
      path: '/api/v1/tenant/users',
      headers: { authorization: 'Bearer token' },
      query: {},
      params: {},
      body: {},
    };
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request.query).toEqual({ tenantId: 't1' });
    expect(request.body).toEqual({ tenantId: 't1' });
  });

  it('拒绝未授权窗口并允许已授权窗口', async () => {
    auth.verifyAccessToken.mockReturnValue({
      sub: 'a1',
      domain: 'tenant',
      role: 'TENANT_OP',
      tenantId: 't1',
      windows: ['dashboard'],
    });
    const request = {
      path: '/api/v1/tenant/users',
      headers: { authorization: 'Bearer token' },
      query: { tenantId: 't1' },
      params: {},
      body: {},
    };
    await expect(guard.canActivate(context(request))).rejects.toThrow(
      ForbiddenException,
    );
    request.path = '/api/v1/tenant/stats';
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
  });

  it('角色权限变化后要求刷新令牌，不能沿用旧窗口权限', async () => {
    auth.verifyAccessToken.mockReturnValue({
      sub: 'a1',
      domain: 'tenant',
      role: 'TENANT_OP',
      roleId: 'role-1',
      tenantId: 't1',
      windows: ['dashboard'],
    });
    roles.accountAccess.mockResolvedValue({
      account: {
        id: 'a1',
        tenantId: 't1',
        sessionVersion: 0,
        mustChangePassword: false,
      },
      roleId: 'role-1',
      roleName: '运营',
      authority: 'TENANT_OP',
      windows: ['users'],
    });
    await expect(
      guard.canActivate(
        context({
          path: '/api/v1/tenant/stats',
          headers: { authorization: 'Bearer token' },
          query: {},
          params: {},
          body: {},
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 40102 } });
  });

  it('临时密码登录后拒绝访问租户业务 API', async () => {
    auth.verifyAccessToken.mockReturnValue({
      sub: 'a1',
      domain: 'tenant',
      role: 'TENANT_ADMIN',
      tenantId: 't1',
      windows: ['settings'],
      mustChangePassword: true,
    });
    await expect(
      guard.canActivate(
        context({
          path: '/api/v1/tenant/users',
          method: 'GET',
          headers: { authorization: 'Bearer token' },
          query: {},
          params: {},
          body: {},
        }),
      ),
    ).rejects.toThrow('必须先设置新密码');
  });

  it('临时密码登录后仅允许提交首次改密接口', async () => {
    auth.verifyAccessToken.mockReturnValue({
      sub: 'a1',
      domain: 'tenant',
      role: 'TENANT_ADMIN',
      tenantId: 't1',
      windows: ['settings'],
      mustChangePassword: true,
    });
    const request = {
      path: '/api/v1/tenant/accounts/initial-password',
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      query: {},
      params: {},
      body: {},
    };
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request.body).toEqual({ tenantId: 't1' });
  });
});
