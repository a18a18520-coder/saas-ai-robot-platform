import { AuthController } from './auth.controller';
import { hashPassword } from './password.util';

describe('AuthController platform identity', () => {
  const auth = {
    issueAccessToken: jest.fn(() => 'access-token'),
    issueRefreshToken: jest.fn(() => 'refresh-token'),
    verifyTotp: jest.fn(),
    readRefreshToken: jest.fn(),
    rotateVerifiedPayload: jest.fn(),
  };
  const config = { get: jest.fn() };
  const tenantAccounts = { findOne: jest.fn(), save: jest.fn() };
  const logs = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  const tenants = { findOne: jest.fn() };
  const oidc = {};
  const dataSource = {};
  const attempts = {
    assertAllowed: jest.fn(),
    recordFailure: jest.fn(),
    reset: jest.fn(),
  };
  const identity = {
    id: 'platform-account-1',
    name: '平台运营',
    account: 'operator@example.com',
    roleId: 'role-1',
    roleName: '平台运营',
    permissions: ['dashboard', 'tenants'],
    isSuperAdmin: false,
    status: 'ACTIVE',
    isBuiltin: false,
    createdAt: new Date(),
  };
  const platformIdentities = {
    authenticate: jest.fn(),
    recordSuccessfulLogin: jest.fn(),
    toAuthPayload: jest.fn(() => ({
      sub: identity.id,
      domain: 'platform',
      role: 'PLATFORM_OP',
      permissions: identity.permissions,
    })),
    activeSession: jest.fn(),
  };
  const tenantRoles = {
    accessForAccount: jest.fn(),
    ensureBuiltinRoles: jest.fn(),
    findRoleByName: jest.fn(),
  };
  const response = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  };
  let controller: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockImplementation(
      (_key: string, fallback?: unknown) => fallback,
    );
    platformIdentities.authenticate.mockResolvedValue(identity);
    platformIdentities.recordSuccessfulLogin.mockResolvedValue(undefined);
    tenants.findOne.mockResolvedValue({
      id: 'tenant-1',
      status: 'ACTIVE',
      config: {},
    });
    tenantRoles.accessForAccount.mockImplementation(async (account) => ({
      account,
      roleId: account.roleId,
      roleName: '管理员',
      authority: account.role === 'TENANT_ADMIN' ? 'TENANT_ADMIN' : 'TENANT_OP',
      windows: account.windows ?? [],
    }));
    controller = new AuthController(
      auth as any,
      config as any,
      tenantAccounts as any,
      logs as any,
      tenants as any,
      oidc as any,
      dataSource as any,
      attempts as any,
      platformIdentities as any,
      tenantRoles as any,
    );
  });

  it('平台账号登录后签发包含角色权限的令牌并记录日志', async () => {
    const result = await controller.platformLogin(
      { ip: '127.0.0.1', socket: {} } as any,
      { account: identity.account, password: 'Operator2026' },
      response as any,
    );

    expect(platformIdentities.authenticate).toHaveBeenCalledWith(
      identity.account,
      'Operator2026',
    );
    expect(platformIdentities.recordSuccessfulLogin).toHaveBeenCalledWith(
      identity.id,
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'platform_refresh_token',
      'refresh-token',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(result).toMatchObject({
      code: 0,
      data: { access_token: 'access-token', roleName: '平台运营' },
    });
    expect(logs.save).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'platform', result: '成功' }),
    );
  });

  it('内置超管配置 TOTP 后必须通过 MFA', async () => {
    platformIdentities.authenticate.mockResolvedValue({
      ...identity,
      isBuiltin: true,
      isSuperAdmin: true,
    });
    config.get.mockImplementation((key: string, fallback?: unknown) =>
      key === 'PLATFORM_TOTP_SECRET' ? 'BASE32SECRET' : fallback,
    );
    auth.verifyTotp.mockReturnValue(false);

    const result = await controller.platformLogin(
      { ip: '127.0.0.1', socket: {} } as any,
      { account: identity.account, password: 'AdminSecure2026' },
      response as any,
    );

    expect(result).toMatchObject({ code: 40101, mfa_required: true });
    expect(response.cookie).not.toHaveBeenCalled();
    expect(attempts.recordFailure).toHaveBeenCalled();
  });

  it('平台账号被禁用后 refresh 会话立即失效', async () => {
    auth.readRefreshToken.mockReturnValue({
      sub: identity.id,
      domain: 'platform',
      role: 'PLATFORM_OP',
    });
    platformIdentities.activeSession.mockResolvedValue(null);

    const result = await controller.refresh(
      { headers: { cookie: 'platform_refresh_token=token' } } as any,
      'platform',
      response as any,
    );

    expect(result).toMatchObject({ code: 40102 });
    expect(response.clearCookie).toHaveBeenCalled();
  });

  it('租户密码重置后旧 refresh 会话无法续期', async () => {
    auth.readRefreshToken.mockReturnValue({
      sub: 'tenant-account-1',
      domain: 'tenant',
      tenantId: 'tenant-1',
      role: 'TENANT_ADMIN',
      roleId: 'tenant-role-admin',
      sessionVersion: 1,
    });
    tenantAccounts.findOne.mockResolvedValue({
      id: 'tenant-account-1',
      tenantId: 'tenant-1',
      role: 'TENANT_ADMIN',
      roleId: 'tenant-role-admin',
      status: 'ACTIVE',
      windows: ['dashboard'],
      sessionVersion: 2,
    });

    const result = await controller.refresh(
      { headers: { cookie: 'tenant_refresh_token=token' } } as any,
      'tenant',
      response as any,
    );

    expect(result).toMatchObject({
      code: 40102,
      message: expect.stringContaining('密码已变更'),
    });
    expect(auth.rotateVerifiedPayload).not.toHaveBeenCalled();
    expect(response.clearCookie).toHaveBeenCalled();
  });

  it('租户使用临时密码登录后，令牌和响应都带强制改密标记', async () => {
    tenantAccounts.findOne.mockResolvedValue({
      id: 'tenant-account-1',
      tenantId: 'tenant-1',
      account: 'admin@example.com',
      name: '租户管理员',
      passwordHash: hashPassword('TempTenant2026'),
      role: 'TENANT_ADMIN',
      roleId: 'tenant-role-admin',
      status: 'ACTIVE',
      windows: ['dashboard', 'settings'],
      sessionVersion: 0,
      mustChangePassword: true,
    });
    tenants.findOne.mockResolvedValue({ id: 'tenant-1', status: 'ACTIVE' });

    const result = await controller.tenantLogin(
      { ip: '127.0.0.1', socket: {} } as any,
      response as any,
      { account: 'admin@example.com', password: 'TempTenant2026' },
    );

    expect(auth.issueAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        roleId: 'tenant-role-admin',
        roleName: '管理员',
        mustChangePassword: true,
      }),
      1800,
    );
    expect(result).toMatchObject({
      code: 0,
      data: {
        roleId: 'tenant-role-admin',
        roleName: '管理员',
        mustChangePassword: true,
      },
    });
  });

  it('租户登录受 IP 白名单约束', async () => {
    tenantAccounts.findOne.mockResolvedValue({
      id: 'tenant-account-1',
      tenantId: 'tenant-1',
      account: 'admin@example.com',
      passwordHash: hashPassword('TenantSecure2026'),
      role: 'TENANT_ADMIN',
      roleId: 'tenant-role-admin',
      status: 'ACTIVE',
      windows: ['dashboard'],
      sessionVersion: 0,
      mustChangePassword: false,
    });
    tenants.findOne.mockResolvedValue({
      id: 'tenant-1',
      status: 'ACTIVE',
      config: {
        security: {
          ipWhitelistEnabled: true,
          ipWhitelist: ['10.0.0.0/24'],
        },
      },
    });

    const result = await controller.tenantLogin(
      { ip: '203.0.113.8', socket: {} } as any,
      response as any,
      { account: 'admin@example.com', password: 'TenantSecure2026' },
    );

    expect(result).toMatchObject({ code: 40303 });
    expect(auth.issueAccessToken).not.toHaveBeenCalled();
    expect(logs.save).toHaveBeenCalledWith(
      expect.objectContaining({ ip: '203.0.113.8', result: '失败' }),
    );
  });

  it('密码过期后允许认证但强制先改密，并套用租户会话时长', async () => {
    const expiredAccount = {
      id: 'tenant-account-1',
      tenantId: 'tenant-1',
      account: 'admin@example.com',
      name: '租户管理员',
      passwordHash: hashPassword('TenantSecure2026'),
      passwordChangedAt: new Date('2020-01-01T00:00:00Z'),
      createdAt: new Date('2020-01-01T00:00:00Z'),
      role: 'TENANT_ADMIN',
      roleId: 'tenant-role-admin',
      status: 'ACTIVE',
      windows: ['dashboard', 'settings'],
      sessionVersion: 2,
      mustChangePassword: false,
    };
    tenantAccounts.findOne.mockResolvedValue(expiredAccount);
    tenants.findOne.mockResolvedValue({
      id: 'tenant-1',
      status: 'ACTIVE',
      config: {
        security: {
          passwordExpiryDays: 90,
          sessionTimeoutMinutes: 60,
        },
      },
    });

    const result = await controller.tenantLogin(
      { ip: '127.0.0.1', socket: {} } as any,
      response as any,
      { account: 'admin@example.com', password: 'TenantSecure2026' },
    );

    expect(expiredAccount.mustChangePassword).toBe(true);
    expect(expiredAccount.sessionVersion).toBe(3);
    expect(result).toMatchObject({
      code: 0,
      data: { mustChangePassword: true },
    });
    expect(auth.issueRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({ sessionTimeoutMinutes: 60 }),
      3600,
    );
  });
});
