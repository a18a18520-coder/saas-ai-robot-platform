import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { CookieOptions, Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { TenantAccount, LoginLog } from './tenant-account.entity';
import { AuditService } from '../audit/audit.service';
import { hashPassword, verifyPassword } from '../auth/password.util';
import { AuthPayload, AuthService } from '../auth/auth.service';
import { RolesService, TenantAccountAccess } from '../roles/roles.service';
import { Tenant } from './tenant.entity';
import {
  passwordPolicyError,
  tenantSecurityPolicy,
  TenantSecurityPolicy,
} from './tenant-security-policy';

type AuthenticatedRequest = Request & { auth?: AuthPayload };

/** 租户管理人员账号 CRUD（settings.html 管理人员 Tab 真实化）+ 登录日志 */
@Controller('api/v1/tenant/accounts')
export class TenantAccountsController {
  constructor(
    @InjectRepository(TenantAccount)
    private readonly repo: Repository<TenantAccount>,
    @InjectRepository(LoginLog) private readonly logs: Repository<LoginLog>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly roles: RolesService,
  ) {}

  /** 临时初始密码只允许进入本接口；改密后轮换访问与刷新凭据。 */
  @Post('initial-password')
  async changeInitialPassword(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { password: string },
  ) {
    const identity = req.auth;
    if (!identity || identity.domain !== 'tenant' || !identity.tenantId) {
      throw new UnauthorizedException({
        code: 40101,
        message: '未登录或租户身份无效',
        data: null,
      });
    }
    const account = await this.repo.findOne({
      where: {
        id: identity.sub,
        tenantId: identity.tenantId,
        status: 'ACTIVE',
      },
    });
    if (!account) {
      throw new UnauthorizedException({
        code: 40101,
        message: '账号不存在或已被禁用',
        data: null,
      });
    }
    const security = await this.securityPolicy(account.tenantId);
    this.assertPassword(body?.password, security);
    if (!account.mustChangePassword) {
      throw new ConflictException({
        code: 40902,
        message: '初始密码已修改，请直接进入租户后台',
        data: null,
      });
    }
    if (verifyPassword(body.password, account.passwordHash)) {
      throw new BadRequestException({
        code: 40002,
        message: '新密码不能与临时初始密码相同',
        data: null,
      });
    }

    const access = await this.roles.accessForAccount(account);
    if (!access) {
      throw new ConflictException({
        code: 40902,
        message: '账号关联的角色已失效，请联系租户管理员',
        data: null,
      });
    }

    account.passwordHash = hashPassword(body.password);
    account.mustChangePassword = false;
    account.sessionVersion = (account.sessionVersion ?? 0) + 1;
    account.passwordChangedAt = new Date();
    await this.repo.save(account);
    await this.audit
      .log({
        tenantId: account.tenantId,
        channelUserId: account.id,
        question: `[账号] 首次登录修改初始密码（${account.account}）`,
        result: '初始密码已替换，旧刷新会话已失效',
      })
      .catch(() => undefined);

    const payload = this.authPayload(access, security, false);
    const sessionSeconds = security.sessionTimeoutMinutes
      ? security.sessionTimeoutMinutes * 60
      : undefined;
    res.cookie(
      'tenant_refresh_token',
      this.auth.issueRefreshToken(payload, sessionSeconds),
      this.refreshCookieOptions(security.sessionTimeoutMinutes),
    );
    return {
      code: 0,
      message: '新密码已设置',
      data: {
        access_token: this.auth.issueAccessToken(
          payload,
          sessionSeconds ? Math.min(30 * 60, sessionSeconds) : undefined,
        ),
        tenantId: account.tenantId,
      },
    };
  }

  /** 可分配角色来自角色权限中心，账号页不再维护独立窗口列表。 */
  @Get('assignable-roles')
  assignableRoles(@Query('tenantId') tenantId: string) {
    return this.roles.listAssignableRoles(tenantId);
  }

  /** 账号列表（密码哈希不外泄，功能权限实时取自绑定角色） */
  @Get()
  async list(@Query('tenantId') tenantId: string) {
    const rows = await this.repo.find({
      where: { tenantId },
      order: { createdAt: 'ASC' },
    });
    return Promise.all(rows.map((account) => this.accountView(account)));
  }

  /** 新建账号（初始密码必填） */
  @Post()
  async create(
    @Body()
    body: {
      tenantId: string;
      name: string;
      account: string;
      password: string;
      roleId: string;
    },
  ) {
    if (
      !body.name?.trim() ||
      !body.account?.trim() ||
      !body.password ||
      !body.roleId
    ) {
      throw new BadRequestException('姓名、账号、初始密码和角色必填');
    }
    const security = await this.securityPolicy(body.tenantId);
    this.assertPassword(body.password, security);
    const assignment = await this.roles.roleAssignment(
      body.tenantId,
      body.roleId,
    );
    const account = body.account.trim();
    const normalizedAccount = account.includes('@')
      ? account.toLowerCase()
      : account;
    const exist = await this.repo.findOne({
      where: { account: account.includes('@') ? ILike(account) : account },
    });
    if (exist) throw new ConflictException('登录账号已存在');
    const saved = await this.repo.save(
      this.repo.create({
        tenantId: body.tenantId,
        name: body.name.trim(),
        account: normalizedAccount,
        passwordHash: hashPassword(body.password),
        role:
          assignment.authority === 'TENANT_ADMIN'
            ? 'TENANT_ADMIN'
            : 'TENANT_OPS',
        roleId: assignment.role.id,
        windows: assignment.windows,
        passwordChangedAt: new Date(),
      }),
    );
    await this.audit
      .log({
        tenantId: body.tenantId,
        question: `[设置] 新增管理人员（${body.name}）`,
        result: `账号=${body.account} · 角色=${assignment.role.name} · 功能权限 ${assignment.windows.length} 项`,
      })
      .catch(() => undefined);
    return this.accountView(saved);
  }

  /** 编辑（姓名/角色/窗口/状态）与重置密码 */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string,
    @Body()
    body: {
      name?: string;
      roleId?: string;
      status?: 'ACTIVE' | 'DISABLED';
      password?: string;
    },
  ) {
    const acc = await this.repo.findOne({ where: { id, tenantId } });
    if (!acc) throw new NotFoundException('账号不存在');
    const assignment = body.roleId
      ? await this.roles.roleAssignment(tenantId, body.roleId)
      : null;
    const nextRole = assignment
      ? assignment.authority === 'TENANT_ADMIN'
        ? 'TENANT_ADMIN'
        : 'TENANT_OPS'
      : acc.role;
    const nextStatus = body.status ?? acc.status;
    // 删除、禁用和降级都不能让租户失去最后一名启用管理员。
    if (
      acc.role === 'TENANT_ADMIN' &&
      acc.status === 'ACTIVE' &&
      (nextRole !== 'TENANT_ADMIN' || nextStatus !== 'ACTIVE')
    ) {
      const activeAdmins = await this.repo.count({
        where: {
          tenantId: acc.tenantId,
          role: 'TENANT_ADMIN',
          status: 'ACTIVE',
        },
      });
      if (activeAdmins <= 1)
        throw new Error(
          '42201: 租户至少保留一名启用状态的管理员，先指派新管理员再调整',
        );
    }
    const security = body.password
      ? await this.securityPolicy(tenantId)
      : undefined;
    if (body.password !== undefined)
      this.assertPassword(body.password, security!);
    if (body.name !== undefined) acc.name = body.name.trim();
    if (assignment) {
      acc.roleId = assignment.role.id;
      acc.role = nextRole;
      acc.windows = assignment.windows;
    }
    if (body.status !== undefined && body.status !== acc.status) {
      acc.status = body.status;
      acc.sessionVersion = (acc.sessionVersion ?? 0) + 1;
    }
    if (body.password) {
      acc.passwordHash = hashPassword(body.password);
      acc.sessionVersion = (acc.sessionVersion ?? 0) + 1;
      acc.mustChangePassword = false;
      acc.passwordChangedAt = new Date();
    }
    const saved = await this.repo.save(acc);
    const view = await this.accountView(saved);
    await this.audit
      .log({
        tenantId: acc.tenantId,
        question: `[设置] ${body.password ? '重置密码' : '更新'}管理人员（${acc.name}）`,
        result: body.password
          ? '密码已重置（下次登录生效）'
          : `角色=${view.roleName} · 状态=${saved.status} · 功能权限 ${view.windows.length} 项`,
      })
      .catch(() => undefined);
    return view;
  }

  /** 删除账号（租户至少保留一名 ACTIVE 管理员） */
  @Delete(':id')
  async remove(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    const acc = await this.repo.findOne({ where: { id, tenantId } });
    if (!acc) throw new Error('40401: 账号不存在');
    const activeAdmins = await this.repo.count({
      where: { tenantId: acc.tenantId, role: 'TENANT_ADMIN', status: 'ACTIVE' },
    });
    if (
      acc.role === 'TENANT_ADMIN' &&
      acc.status === 'ACTIVE' &&
      activeAdmins <= 1
    ) {
      throw new Error(
        '42201: 租户至少保留一名启用状态的管理员，先指派新管理员再删除',
      );
    }
    await this.repo.delete(id);
    await this.audit
      .log({
        tenantId: acc.tenantId,
        question: `[设置] 删除管理人员（${acc.name}）`,
        result: `账号=${acc.account}`,
      })
      .catch(() => undefined);
    return { ok: true };
  }

  /** 登录日志（最近 N 条，settings.html 安全设置 Tab） */
  @Get('login-logs')
  async loginLogs(
    @Query('tenantId') tenantId: string,
    @Query('limit') limit?: string,
  ) {
    return this.logs.find({
      where: { tenantId, domain: 'tenant' },
      order: { createdAt: 'DESC' },
      take: Number(limit ?? 20),
    });
  }

  private async accountView(account: TenantAccount) {
    const { passwordHash: _passwordHash, ...safe } = account;
    return {
      ...safe,
      ...(await this.roles.accountView(account)),
    };
  }

  private authPayload(
    access: TenantAccountAccess,
    security: TenantSecurityPolicy,
    mustChangePassword = access.account.mustChangePassword,
  ): AuthPayload {
    return {
      sub: access.account.id,
      domain: 'tenant',
      tenantId: access.account.tenantId,
      role: access.authority,
      roleId: access.roleId,
      roleName: access.roleName,
      windows: access.windows,
      sessionVersion: access.account.sessionVersion,
      mustChangePassword,
      sessionTimeoutMinutes: security.sessionTimeoutMinutes ?? undefined,
    };
  }

  private refreshCookieOptions(
    sessionTimeoutMinutes?: number | null,
  ): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('NODE_ENV') === 'production',
      path: '/api/v1/platform/auth',
      maxAge: sessionTimeoutMinutes
        ? sessionTimeoutMinutes * 60 * 1000
        : 7 * 24 * 3600 * 1000,
    };
  }

  private async securityPolicy(
    tenantId: string,
  ): Promise<TenantSecurityPolicy> {
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('租户不存在');
    return tenantSecurityPolicy(tenant.config);
  }

  private assertPassword(
    password: unknown,
    security: TenantSecurityPolicy,
  ): asserts password is string {
    const error = passwordPolicyError(password, security);
    if (error)
      throw new BadRequestException({
        code: 40002,
        message: error,
        data: null,
      });
  }
}
