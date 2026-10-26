import { UnprocessableEntityException } from '@nestjs/common';
import { verifyPassword } from '../auth/password.util';
import { PlatformAccount, PlatformRole } from './platform-identity.entity';
import { PlatformIdentityService } from './platform-identity.service';

describe('PlatformIdentityService', () => {
  let roleRows: PlatformRole[];
  let accountRows: PlatformAccount[];
  let sequence: number;
  let service: PlatformIdentityService;

  const valueOf = (condition: unknown): string | undefined => {
    if (typeof condition === 'string') return condition;
    if (condition && typeof condition === 'object') {
      return String((condition as { _value?: unknown })._value ?? '');
    }
    return undefined;
  };

  beforeEach(() => {
    roleRows = [];
    accountRows = [];
    sequence = 0;
    const roles = {
      findOne: jest.fn(
        async ({ where }: any) =>
          roleRows.find(
            (row) =>
              (!where.id || row.id === where.id) &&
              (!where.code || row.code === where.code) &&
              (!where.name ||
                row.name.toLowerCase() === valueOf(where.name)?.toLowerCase()),
          ) ?? null,
      ),
      find: jest.fn(async () => [...roleRows]),
      create: jest.fn((value) => ({ ...value })),
      save: jest.fn(async (value) => {
        const row = value as PlatformRole;
        if (!row.id) {
          row.id = `role-${++sequence}`;
          row.createdAt = new Date();
          row.updatedAt = new Date();
          roleRows.push(row);
        }
        return row;
      }),
      delete: jest.fn(async (id) => {
        roleRows = roleRows.filter((row) => row.id !== id);
      }),
    };
    const accounts = {
      findOne: jest.fn(
        async ({ where }: any) =>
          accountRows.find(
            (row) =>
              (!where.id || row.id === where.id) &&
              (where.isBuiltin === undefined ||
                row.isBuiltin === where.isBuiltin) &&
              (!where.status || row.status === where.status) &&
              (!where.account ||
                row.account.toLowerCase() ===
                  valueOf(where.account)?.toLowerCase()),
          ) ?? null,
      ),
      find: jest.fn(async () => [...accountRows]),
      create: jest.fn((value) => ({ ...value })),
      save: jest.fn(async (value) => {
        const row = value as PlatformAccount;
        if (!row.id) {
          row.id = `account-${++sequence}`;
          row.createdAt = new Date();
          row.updatedAt = new Date();
          accountRows.push(row);
        }
        return row;
      }),
      update: jest.fn(async (id, patch) => {
        const row = accountRows.find((item) => item.id === id);
        if (row) Object.assign(row, patch);
      }),
      count: jest.fn(
        async ({ where }: any) =>
          accountRows.filter((row) => row.roleId === where.roleId).length,
      ),
      delete: jest.fn(async (id) => {
        accountRows = accountRows.filter((row) => row.id !== id);
      }),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'NODE_ENV' ? 'development' : undefined,
      ),
    };
    service = new PlatformIdentityService(
      accounts as any,
      roles as any,
      config as any,
    );
  });

  it('幂等初始化固定超管和三个内置角色', async () => {
    const first = await service.ensureBuiltins();
    const second = await service.ensureBuiltins();

    expect(roleRows).toHaveLength(3);
    expect(accountRows).toHaveLength(1);
    expect(first).toMatchObject({
      account: 'admin@platform.local',
      roleName: '超级管理员',
      isBuiltin: true,
      isSuperAdmin: true,
      status: 'ACTIVE',
    });
    expect(second.id).toBe(first.id);
    expect(verifyPassword('Admin@2026!', accountRows[0].passwordHash)).toBe(
      true,
    );
  });

  it('自定义角色可授权并创建可登录的平台账号', async () => {
    await service.ensureBuiltins();
    const role = await service.createRole({
      name: '客户成功',
      permissions: ['dashboard', 'tenants', 'invalid'],
    });
    const created = await service.createAccount({
      name: '王运营',
      account: 'Operator@Example.com',
      password: 'Operator2026',
      roleId: role.id,
    });

    expect(created).toMatchObject({
      account: 'operator@example.com',
      roleName: '客户成功',
      permissions: ['dashboard', 'tenants'],
    });
    await expect(
      service.authenticate('operator@example.com', 'Operator2026'),
    ).resolves.toMatchObject({ id: created.id, isSuperAdmin: false });
    await expect(
      service.authenticate('operator@example.com', 'wrong-password'),
    ).resolves.toBeNull();
  });

  it('内置超管不可禁用或删除', async () => {
    const admin = await service.ensureBuiltins();
    await expect(
      service.updateAccount(admin.id, { status: 'DISABLED' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.removeAccount(admin.id)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('普通平台账号不可获得内置超管角色', async () => {
    await service.ensureBuiltins();
    const superRole = roleRows.find((role) => role.isSuperAdmin)!;

    await expect(
      service.createAccount({
        name: '第二超管',
        account: 'another-admin@example.com',
        password: 'AdminSecure2026',
        roleId: superRole.id,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
