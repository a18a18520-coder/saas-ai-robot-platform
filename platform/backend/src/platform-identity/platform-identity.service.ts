import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import type { AuthPayload } from '../auth/auth.service';
import { hashPassword, verifyPassword } from '../auth/password.util';
import {
  PLATFORM_PERMISSION_KEYS,
  PlatformAccount,
  PlatformPermission,
  PlatformRole,
} from './platform-identity.entity';

const DEFAULT_DEVELOPMENT_ADMIN = {
  account: 'admin@platform.local',
  password: 'Admin@2026!',
};

const DEFAULT_ROLES: Array<
  Pick<
    PlatformRole,
    | 'code'
    | 'name'
    | 'description'
    | 'permissions'
    | 'isBuiltin'
    | 'isSuperAdmin'
  >
> = [
  {
    code: 'SUPER_ADMIN',
    name: '超级管理员',
    description: '平台全部权限，可管理账号与角色',
    permissions: [...PLATFORM_PERMISSION_KEYS],
    isBuiltin: true,
    isSuperAdmin: true,
  },
  {
    code: 'PLATFORM_OPERATOR',
    name: '平台运营',
    description: '租户、套餐、支付、AI 资源与日常运营',
    permissions: [
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
    ],
    isBuiltin: true,
    isSuperAdmin: false,
  },
  {
    code: 'PLATFORM_AUDITOR',
    name: '平台审计员',
    description: '只读查看平台概览、统计、审计与通知',
    permissions: ['dashboard', 'notifications', 'audit', 'stats'],
    isBuiltin: true,
    isSuperAdmin: false,
  },
];

export interface PlatformAccountView {
  id: string;
  name: string;
  account: string;
  roleId: string;
  roleName: string;
  permissions: PlatformPermission[];
  isSuperAdmin: boolean;
  status: 'ACTIVE' | 'DISABLED';
  isBuiltin: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
}

@Injectable()
export class PlatformIdentityService implements OnModuleInit {
  private readonly logger = new Logger(PlatformIdentityService.name);

  constructor(
    @InjectRepository(PlatformAccount)
    private readonly accounts: Repository<PlatformAccount>,
    @InjectRepository(PlatformRole)
    private readonly roles: Repository<PlatformRole>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureBuiltins();
  }

  /** 幂等初始化三个默认角色和唯一内置超管。 */
  async ensureBuiltins(): Promise<PlatformAccountView> {
    for (const definition of DEFAULT_ROLES) {
      const existing = await this.roles.findOne({
        where: { code: definition.code },
      });
      if (!existing) {
        await this.roles.save(this.roles.create(definition));
      }
    }

    const superRole = await this.roles.findOne({
      where: { code: 'SUPER_ADMIN' },
    });
    if (!superRole) throw new Error('内置超管角色初始化失败');

    const production = this.config.get('NODE_ENV') === 'production';
    const configuredAccount = this.config
      .get<string>('PLATFORM_SUPER_ADMIN_EMAIL')
      ?.trim()
      .toLowerCase();
    const configuredPassword = this.config.get<string>(
      'PLATFORM_SUPER_ADMIN_PASSWORD',
    );
    const account =
      configuredAccount ||
      (production ? '' : DEFAULT_DEVELOPMENT_ADMIN.account);
    const password =
      configuredPassword ||
      (production ? '' : DEFAULT_DEVELOPMENT_ADMIN.password);
    if (!account || !password) {
      throw new Error('生产环境必须配置平台超管账号和密码');
    }
    this.assertPassword(password, production ? 10 : 8);

    let builtin = await this.accounts.findOne({ where: { isBuiltin: true } });
    if (!builtin) {
      builtin = this.accounts.create({
        name: '平台超级管理员',
        account,
        passwordHash: hashPassword(password),
        roleId: superRole.id,
        status: 'ACTIVE',
        isBuiltin: true,
      });
    } else {
      builtin.name = '平台超级管理员';
      builtin.account = account;
      builtin.roleId = superRole.id;
      builtin.status = 'ACTIVE';
      if (!verifyPassword(password, builtin.passwordHash)) {
        builtin.passwordHash = hashPassword(password);
      }
      builtin.updatedAt = new Date();
    }
    const saved = await this.accounts.save(builtin);
    if (!configuredAccount && !production) {
      this.logger.warn(
        `仅开发环境使用默认平台账号 ${DEFAULT_DEVELOPMENT_ADMIN.account}，部署前请通过环境变量替换`,
      );
    }
    return this.toView(saved, superRole);
  }

  listRoles(): Promise<PlatformRole[]> {
    return this.roles.find({ order: { isSuperAdmin: 'DESC', name: 'ASC' } });
  }

  async createRole(body: {
    name: string;
    description?: string;
    permissions?: unknown[];
  }): Promise<PlatformRole> {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('角色名称必填');
    const duplicate = await this.roles.findOne({
      where: { name: ILike(name) },
    });
    if (duplicate) throw new ConflictException('角色名称已存在');
    return this.roles.save(
      this.roles.create({
        code: `CUSTOM_${randomUUID()}`,
        name,
        description: body.description?.trim() || undefined,
        permissions: this.validPermissions(body.permissions),
        isBuiltin: false,
        isSuperAdmin: false,
      }),
    );
  }

  async updateRole(
    id: string,
    body: { name?: string; description?: string; permissions?: unknown[] },
  ): Promise<PlatformRole> {
    const role = await this.findRole(id);
    if (role.isBuiltin)
      throw new UnprocessableEntityException('内置角色不可修改');
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) throw new BadRequestException('角色名称必填');
      const duplicate = await this.roles.findOne({
        where: { name: ILike(name) },
      });
      if (duplicate && duplicate.id !== id)
        throw new ConflictException('角色名称已存在');
      role.name = name;
    }
    if (body.description !== undefined)
      role.description = body.description.trim() || undefined;
    if (body.permissions !== undefined)
      role.permissions = this.validPermissions(body.permissions);
    role.updatedAt = new Date();
    return this.roles.save(role);
  }

  async removeRole(id: string): Promise<{ ok: true }> {
    const role = await this.findRole(id);
    if (role.isBuiltin)
      throw new UnprocessableEntityException('内置角色不可删除');
    if ((await this.accounts.count({ where: { roleId: id } })) > 0) {
      throw new ConflictException('该角色仍有账号在使用，请先调整账号角色');
    }
    await this.roles.delete(id);
    return { ok: true };
  }

  async listAccounts(): Promise<PlatformAccountView[]> {
    const [accounts, roles] = await Promise.all([
      this.accounts.find({ order: { isBuiltin: 'DESC', createdAt: 'ASC' } }),
      this.roles.find(),
    ]);
    const roleMap = new Map(roles.map((role) => [role.id, role]));
    return accounts.map((account) =>
      this.toView(account, roleMap.get(account.roleId)),
    );
  }

  async createAccount(body: {
    name: string;
    account: string;
    password: string;
    roleId: string;
  }): Promise<PlatformAccountView> {
    const name = body.name?.trim();
    const account = this.normalizeAccount(body.account);
    if (!name || !account || !body.password || !body.roleId) {
      throw new BadRequestException('姓名、账号、初始密码和角色必填');
    }
    this.assertPassword(body.password);
    const role = await this.findRole(body.roleId);
    this.assertAssignableRole(role);
    if (await this.findByAccount(account))
      throw new ConflictException('平台账号已存在');
    const saved = await this.accounts.save(
      this.accounts.create({
        name,
        account,
        passwordHash: hashPassword(body.password),
        roleId: role.id,
        status: 'ACTIVE',
        isBuiltin: false,
      }),
    );
    return this.toView(saved, role);
  }

  async updateAccount(
    id: string,
    body: {
      name?: string;
      roleId?: string;
      status?: 'ACTIVE' | 'DISABLED';
      password?: string;
    },
  ): Promise<PlatformAccountView> {
    const account = await this.accounts.findOne({ where: { id } });
    if (!account) throw new NotFoundException('平台账号不存在');
    if (account.isBuiltin) {
      throw new UnprocessableEntityException(
        '内置超管由部署配置维护，不可在管理台修改',
      );
    }
    if (body.name !== undefined) {
      if (!body.name.trim()) throw new BadRequestException('姓名必填');
      account.name = body.name.trim();
    }
    let role = await this.findRole(account.roleId);
    if (body.roleId !== undefined) {
      role = await this.findRole(body.roleId);
      this.assertAssignableRole(role);
      account.roleId = role.id;
    }
    if (body.status !== undefined) account.status = body.status;
    if (body.password !== undefined) {
      this.assertPassword(body.password);
      account.passwordHash = hashPassword(body.password);
    }
    account.updatedAt = new Date();
    return this.toView(await this.accounts.save(account), role);
  }

  async removeAccount(id: string): Promise<{ ok: true }> {
    const account = await this.accounts.findOne({ where: { id } });
    if (!account) throw new NotFoundException('平台账号不存在');
    if (account.isBuiltin)
      throw new UnprocessableEntityException('内置超管账号不可删除');
    await this.accounts.delete(id);
    return { ok: true };
  }

  async authenticate(
    rawAccount: string,
    password: string,
  ): Promise<PlatformAccountView | null> {
    const account = await this.findByAccount(this.normalizeAccount(rawAccount));
    if (
      !account ||
      account.status !== 'ACTIVE' ||
      !verifyPassword(password, account.passwordHash)
    ) {
      return null;
    }
    const role = await this.roles.findOne({ where: { id: account.roleId } });
    if (!role) return null;
    return this.toView(account, role);
  }

  async recordSuccessfulLogin(id: string): Promise<void> {
    await this.accounts.update(id, {
      lastLoginAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async activeSession(id: string): Promise<PlatformAccountView | null> {
    const account = await this.accounts.findOne({
      where: { id, status: 'ACTIVE' },
    });
    if (!account) return null;
    const role = await this.roles.findOne({ where: { id: account.roleId } });
    return role ? this.toView(account, role) : null;
  }

  toAuthPayload(account: PlatformAccountView): AuthPayload {
    return {
      sub: account.id,
      domain: 'platform',
      role: account.isSuperAdmin ? 'SUPER_ADMIN' : 'PLATFORM_OP',
      permissions: account.permissions,
      name: account.name,
      roleName: account.roleName,
    };
  }

  private async findRole(id: string): Promise<PlatformRole> {
    const role = await this.roles.findOne({ where: { id } });
    if (!role) throw new NotFoundException('平台角色不存在');
    return role;
  }

  private findByAccount(account: string): Promise<PlatformAccount | null> {
    if (!account) return Promise.resolve(null);
    return this.accounts.findOne({ where: { account: ILike(account) } });
  }

  private toView(
    account: PlatformAccount,
    role?: PlatformRole,
  ): PlatformAccountView {
    if (!role) throw new Error(`平台账号 ${account.id} 缺少有效角色`);
    return {
      id: account.id,
      name: account.name,
      account: account.account,
      roleId: role.id,
      roleName: role.name,
      permissions: role.permissions,
      isSuperAdmin: role.isSuperAdmin,
      status: account.status,
      isBuiltin: account.isBuiltin,
      lastLoginAt: account.lastLoginAt,
      createdAt: account.createdAt,
    };
  }

  private validPermissions(values?: unknown[]): PlatformPermission[] {
    const allowed = new Set<string>(PLATFORM_PERMISSION_KEYS);
    return [
      ...new Set(
        (values ?? [])
          .map(String)
          .filter((value): value is PlatformPermission => allowed.has(value)),
      ),
    ];
  }

  private normalizeAccount(value?: string): string {
    return value?.trim().toLowerCase() ?? '';
  }

  private assertPassword(password: string, minimumLength = 10): void {
    if (
      password.length < minimumLength ||
      !/[a-z]/i.test(password) ||
      !/\d/.test(password)
    ) {
      throw new BadRequestException(`密码至少 ${minimumLength} 位，且必须同时包含字母和数字`);
    }
  }

  private assertAssignableRole(role: PlatformRole): void {
    if (role.isSuperAdmin) {
      throw new UnprocessableEntityException(
        '超级管理员角色仅属于部署内置的固定账号',
      );
    }
  }
}
