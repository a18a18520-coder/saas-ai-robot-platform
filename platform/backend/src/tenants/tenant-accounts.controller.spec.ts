import { TenantAccountsController } from './tenant-accounts.controller';
import { hashPassword, verifyPassword } from '../auth/password.util';

describe('TenantAccountsController — 首次登录强制改密', () => {
  const account = {
    id: 'account-1',
    tenantId: 'tenant-1',
    name: '租户管理员',
    account: 'admin@example.com',
    passwordHash: hashPassword('TempTenant2026'),
    role: 'TENANT_ADMIN' as const,
    roleId: 'role-admin',
    windows: ['dashboard', 'settings'],
    status: 'ACTIVE' as const,
    sessionVersion: 0,
    mustChangePassword: true,
  };
  const repo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const tenants = {
    findOne: jest.fn(async () => ({ id: 'tenant-1', config: {} })),
  };
  const audit = { log: jest.fn(async () => ({})) };
  const auth = {
    issueAccessToken: jest.fn(() => 'new-access-token'),
    issueRefreshToken: jest.fn(() => 'new-refresh-token'),
  };
  const config = { get: jest.fn((_key: string) => 'test') };
  const response = { cookie: jest.fn() };
  const roles = {
    accessForAccount: jest.fn(),
    roleAssignment: jest.fn(),
    accountView: jest.fn(),
  };
  const request = {
    auth: {
      sub: 'account-1',
      domain: 'tenant',
      tenantId: 'tenant-1',
      role: 'TENANT_ADMIN',
      mustChangePassword: true,
    },
  };

  let controller: TenantAccountsController;

  beforeEach(() => {
    jest.clearAllMocks();
    account.passwordHash = hashPassword('TempTenant2026');
    account.sessionVersion = 0;
    account.mustChangePassword = true;
    repo.findOne.mockResolvedValue(account);
    repo.create.mockImplementation((value) => value);
    repo.save.mockImplementation(async (value) => value);
    roles.accessForAccount.mockImplementation(async (currentAccount) => ({
      account: currentAccount,
      roleId: currentAccount.roleId,
      roleName: '管理员',
      authority: 'TENANT_ADMIN',
      windows: currentAccount.windows,
    }));
    controller = new TenantAccountsController(
      repo as any,
      {} as any,
      tenants as any,
      audit as any,
      auth as any,
      config as any,
      roles as any,
    );
  });

  it('替换临时密码、提升会话版本并签发非临时的新凭据', async () => {
    const result = await controller.changeInitialPassword(
      request as any,
      response as any,
      { password: 'MySecure2026' },
    );

    expect(verifyPassword('MySecure2026', account.passwordHash)).toBe(true);
    expect(account.mustChangePassword).toBe(false);
    expect(account.sessionVersion).toBe(1);
    expect(auth.issueRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionVersion: 1,
        roleId: 'role-admin',
        roleName: '管理员',
        mustChangePassword: false,
      }),
      1800,
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'tenant_refresh_token',
      'new-refresh-token',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(result.data.access_token).toBe('new-access-token');
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('MySecure2026');
  });

  it('拒绝继续使用临时密码', async () => {
    await expect(
      controller.changeInitialPassword(request as any, response as any, {
        password: 'TempTenant2026',
      }),
    ).rejects.toThrow('不能与临时初始密码相同');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('新建管理账号时绑定角色并使用该角色的实时功能权限', async () => {
    repo.findOne.mockResolvedValue(null);
    roles.roleAssignment.mockResolvedValue({
      role: { id: 'role-service', name: '客服主管' },
      authority: 'TENANT_OP',
      windows: ['messages', 'users'],
    });
    roles.accountView.mockResolvedValue({
      roleId: 'role-service',
      roleName: '客服主管',
      windows: ['messages', 'users'],
      roleAvailable: true,
    });

    await controller.create({
      tenantId: 'tenant-1',
      name: '客服一组',
      account: 'service@example.com',
      password: 'Service2026',
      roleId: 'role-service',
    });

    expect(roles.roleAssignment).toHaveBeenCalledWith(
      'tenant-1',
      'role-service',
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'TENANT_OPS',
        roleId: 'role-service',
        windows: ['messages', 'users'],
      }),
    );
  });
});
