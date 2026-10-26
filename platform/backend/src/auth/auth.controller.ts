import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { CookieOptions, Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { TenantAccount, LoginLog } from '../tenants/tenant-account.entity';
import { hashPassword, verifyPassword } from './password.util';
import { Tenant } from '../tenants/tenant.entity';
import { OidcService } from './oidc.service';
import { LoginAttemptLimiter } from './login-attempt-limiter.service';
import { PlatformIdentityService } from '../platform-identity/platform-identity.service';
import {
  isStrongTenantPassword,
  TENANT_ADMIN_WINDOWS,
} from '../tenants/tenant-account.defaults';
import { RolesService, TenantAccountAccess } from '../roles/roles.service';
import {
  isIpAllowed,
  isPasswordExpired,
  passwordPolicyError,
  tenantSecurityPolicy,
  TenantSecurityPolicy,
} from '../tenants/tenant-security-policy';

/** 平台侧独立登录（FR-030）：POST /api/v1/platform/auth/*
 * 内置超管（启动时幂等写库）: PLATFORM_SUPER_ADMIN_EMAIL / PASSWORD
 * MFA: 内置超管配置 Base32 密钥后启用 TOTP
 */
@Controller('api/v1/platform/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    @InjectRepository(TenantAccount)
    private readonly accounts: Repository<TenantAccount>,
    @InjectRepository(LoginLog) private readonly logs: Repository<LoginLog>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly oidc: OidcService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly loginAttempts: LoginAttemptLimiter,
    private readonly platformIdentities: PlatformIdentityService,
    private readonly roles: RolesService,
  ) {}

  /** 平台管理员登录：数据库账号 + 角色权限，内置超管可选 MFA。 */
  @Post('login')
  async platformLogin(
    @Req() req: Request,
    @Body() body: { account: string; password: string; mfaCode?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = this.clientIp(req);
    const account = body?.account?.trim();
    const password = body?.password ?? '';
    this.loginAttempts.assertAllowed('platform', account, ip);
    const totpSecret = this.config.get<string>('PLATFORM_TOTP_SECRET');
    const identity = await this.platformIdentities.authenticate(
      account ?? '',
      password,
    );
    if (!identity) {
      this.loginAttempts.recordFailure('platform', account, ip);
      await this.logPlatformLogin(account, ip, '失败');
      return {
        code: 40101,
        message: '账号或密码错误',
        data: null,
        mfa_required: false,
      };
    }

    if (
      identity.isBuiltin &&
      totpSecret &&
      !this.auth.verifyTotp(totpSecret, body?.mfaCode ?? '')
    ) {
      this.loginAttempts.recordFailure('platform', account, ip);
      await this.logPlatformLogin(account, ip, '失败');
      return {
        code: 40101,
        message: 'MFA 验证码错误或缺失',
        data: null,
        mfa_required: true,
      };
    }

    this.loginAttempts.reset('platform', account, ip);
    await this.platformIdentities.recordSuccessfulLogin(identity.id);
    await this.logPlatformLogin(identity.account, ip, '成功');
    const payload = this.platformIdentities.toAuthPayload(identity);
    const accessToken = this.auth.issueAccessToken(payload);
    const refreshToken = this.auth.issueRefreshToken(payload);
    res.cookie(
      'platform_refresh_token',
      refreshToken,
      this.refreshCookieOptions(),
    );
    return {
      code: 0,
      message: 'success',
      data: {
        access_token: accessToken,
        account: identity.account,
        name: identity.name,
        roleName: identity.roleName,
        permissions: identity.permissions,
      },
      mfa_required: false,
    };
  }

  /** 租户侧登录（tenant 域）：仅接受 tenant_accounts 中真实且启用的账号。 */
  @Post('tenant/login')
  async tenantLogin(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { account: string; password: string },
  ) {
    const ip = this.clientIp(req);
    const account = body?.account?.trim();
    const password = body?.password ?? '';
    let security = tenantSecurityPolicy(undefined);
    const logFail = async (tenantId?: string) => {
      this.loginAttempts.recordFailure(
        'tenant',
        account,
        ip,
        this.loginAttemptPolicy(security),
      );
      await this.logs
        .save(
          this.logs.create({
            tenantId,
            account: account ?? '',
            domain: 'tenant',
            ip,
            result: '失败',
          }),
        )
        .catch(() => undefined);
    };

    const acc = account
      ? await this.accounts.findOne({
          where: { account: account.includes('@') ? ILike(account) : account },
        })
      : null;
    if (acc) {
      const tenant = await this.tenants.findOne({
        where: { id: acc.tenantId, status: 'ACTIVE' },
      });
      security = tenantSecurityPolicy(tenant?.config);
      this.loginAttempts.assertAllowed(
        'tenant',
        account,
        ip,
        this.loginAttemptPolicy(security),
      );
      if (acc.status !== 'ACTIVE' || !tenant) {
        await logFail(acc.tenantId);
        return {
          code: 40301,
          message: !tenant
            ? '租户未激活或已停用'
            : '账号已禁用，请联系租户管理员',
          data: null,
        };
      }
      if (
        security.ipWhitelistEnabled &&
        !isIpAllowed(ip, security.ipWhitelist)
      ) {
        await logFail(acc.tenantId);
        return {
          code: 40303,
          message: '当前 IP 不在租户登录白名单中',
          data: null,
        };
      }
      if (!verifyPassword(password, acc.passwordHash)) {
        await logFail(acc.tenantId);
        return { code: 40101, message: '账号或密码错误', data: null };
      }
      const access = await this.roles.accessForAccount(acc);
      if (!access) {
        await logFail(acc.tenantId);
        return {
          code: 40301,
          message: '账号关联的角色已禁用或失效，请联系租户管理员',
          data: null,
        };
      }
      if (
        !acc.mustChangePassword &&
        isPasswordExpired(acc.passwordChangedAt, acc.createdAt, security)
      ) {
        acc.mustChangePassword = true;
        acc.sessionVersion = (acc.sessionVersion ?? 0) + 1;
      }
      acc.lastLoginAt = new Date();
      await this.accounts.save(acc);
      await this.logs
        .save(
          this.logs.create({
            tenantId: acc.tenantId,
            account: acc.account,
            domain: 'tenant',
            ip,
            result: '成功',
          }),
        )
        .catch(() => undefined);
      this.loginAttempts.reset('tenant', account, ip);
      const payload = this.tenantAuthPayload(access, security);
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
        message: 'success',
        data: {
          access_token: this.auth.issueAccessToken(
            payload,
            sessionSeconds ? Math.min(30 * 60, sessionSeconds) : undefined,
          ),
          tenantId: acc.tenantId,
          account: acc.account,
          name: acc.name,
          role: acc.role,
          roleId: access.roleId,
          roleName: access.roleName,
          windows: access.windows,
          mustChangePassword: acc.mustChangePassword,
        },
      };
    }
    this.loginAttempts.assertAllowed(
      'tenant',
      account,
      ip,
      this.loginAttemptPolicy(security),
    );
    await logFail();
    return { code: 40101, message: '账号或密码错误', data: null };
  }

  /** 获取企业 OIDC 登录入口；未配置时明确返回 enabled=false。 */
  @Get('tenant/sso')
  tenantSso() {
    const enabled = this.oidc.isEnabled();
    return {
      code: 0,
      message: 'success',
      data: {
        enabled,
        authorizationUrl: enabled ? this.oidc.createAuthorizationUrl() : null,
      },
    };
  }

  /** OIDC 回调：UserInfo 邮箱必须对应已启用的租户账号。访问令牌放 URL fragment，避免进入代理日志。 */
  @Get('tenant/sso/callback')
  async tenantSsoCallback(
    @Req() req: Request,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const appUrl = this.config
      .get('PUBLIC_APP_URL', 'http://localhost:5173')
      .replace(/\/$/, '');
    try {
      const profile = await this.oidc.exchange(code, state);
      const acc = await this.accounts.findOne({
        where: { account: ILike(profile.email), status: 'ACTIVE' },
      });
      if (!acc) throw new UnauthorizedException('SSO 账号未获授权');
      const tenant = await this.tenants.findOne({
        where: { id: acc.tenantId, status: 'ACTIVE' },
      });
      if (!tenant) throw new UnauthorizedException('租户未激活或已停用');
      const security = tenantSecurityPolicy(tenant.config);
      const ip = this.clientIp(req);
      if (security.ipWhitelistEnabled && !isIpAllowed(ip, security.ipWhitelist))
        throw new UnauthorizedException('当前 IP 不在租户登录白名单中');
      const access = await this.roles.accessForAccount(acc);
      if (!access)
        throw new UnauthorizedException('账号关联的角色已禁用或失效');
      if (
        !acc.mustChangePassword &&
        isPasswordExpired(acc.passwordChangedAt, acc.createdAt, security)
      ) {
        acc.mustChangePassword = true;
        acc.sessionVersion = (acc.sessionVersion ?? 0) + 1;
      }
      acc.lastLoginAt = new Date();
      await this.accounts.save(acc);
      await this.logs
        .save(
          this.logs.create({
            tenantId: acc.tenantId,
            account: acc.account,
            domain: 'tenant',
            ip,
            result: '成功',
          }),
        )
        .catch(() => undefined);
      const payload = this.tenantAuthPayload(access, security);
      const sessionSeconds = security.sessionTimeoutMinutes
        ? security.sessionTimeoutMinutes * 60
        : undefined;
      res.cookie(
        'tenant_refresh_token',
        this.auth.issueRefreshToken(payload, sessionSeconds),
        this.refreshCookieOptions(security.sessionTimeoutMinutes),
      );
      return res.redirect(
        `${appUrl}/tenant-login#sso_token=${encodeURIComponent(
          this.auth.issueAccessToken(
            payload,
            sessionSeconds ? Math.min(30 * 60, sessionSeconds) : undefined,
          ),
        )}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SSO 登录失败';
      return res.redirect(
        `${appUrl}/tenant-login#sso_error=${encodeURIComponent(message)}`,
      );
    }
  }

  /** 激活租户管理员：新租户可替换临时密码；兼容旧的待激活租户。 */
  @Post('tenant/activate')
  async tenantActivate(
    @Body() body: { token: string; name: string; password: string },
  ) {
    if (!body?.name?.trim() || !isStrongTenantPassword(body?.password)) {
      throw new BadRequestException({
        code: 40002,
        message: '姓名必填，密码需为 10-128 位且同时包含字母和数字',
        data: null,
      });
    }
    const activation = this.auth.readActivationToken(body.token);
    await this.roles.ensureBuiltinRoles(activation.tenantId);
    const administratorRole = await this.roles.findRoleByName(
      activation.tenantId,
      '管理员',
    );
    if (!administratorRole) throw new Error('租户管理员角色初始化失败');
    const account = await this.dataSource.transaction(async (manager) => {
      const tenants = manager.getRepository(Tenant);
      const accounts = manager.getRepository(TenantAccount);
      const tenant = await tenants.findOne({
        where: { id: activation.tenantId, adminEmail: activation.email },
      });
      if (!tenant || tenant.status === 'DELETED')
        throw new UnauthorizedException({
          code: 40102,
          message: '激活链接与租户不匹配',
          data: null,
        });
      const passwordError = passwordPolicyError(
        body.password,
        tenantSecurityPolicy(tenant.config),
      );
      if (passwordError)
        throw new BadRequestException({
          code: 40002,
          message: passwordError,
          data: null,
        });
      const existing = await accounts.findOne({
        where: { account: ILike(activation.email) },
      });
      if (existing) {
        if (
          existing.tenantId !== tenant.id ||
          tenant.adminAccountId !== existing.id ||
          !existing.mustChangePassword
        ) {
          throw new ConflictException({
            code: 40901,
            message: '管理员账号已经激活，请直接登录',
            data: null,
          });
        }
        existing.name = body.name.trim();
        existing.passwordHash = hashPassword(body.password);
        existing.mustChangePassword = false;
        existing.passwordChangedAt = new Date();
        existing.sessionVersion = (existing.sessionVersion ?? 0) + 1;
        existing.status = 'ACTIVE';
        existing.role = 'TENANT_ADMIN';
        existing.roleId = administratorRole.id;
        existing.windows = [...TENANT_ADMIN_WINDOWS];
        tenant.status = 'ACTIVE';
        await tenants.save(tenant);
        return accounts.save(existing);
      }
      if (tenant.adminAccountId)
        throw new ConflictException({
          code: 40901,
          message: '管理员账号已经激活，请直接登录',
          data: null,
        });
      const created = await accounts.save(
        accounts.create({
          tenantId: tenant.id,
          name: body.name.trim(),
          account: activation.email.trim().toLowerCase(),
          passwordHash: hashPassword(body.password),
          role: 'TENANT_ADMIN',
          roleId: administratorRole.id,
          windows: [...TENANT_ADMIN_WINDOWS],
          status: 'ACTIVE',
          sessionVersion: 0,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
        }),
      );
      tenant.adminAccountId = created.id;
      tenant.status = 'ACTIVE';
      await tenants.save(tenant);
      return created;
    });
    return {
      code: 0,
      message: '管理员账号已激活',
      data: { account: account.account, tenantId: account.tenantId },
    };
  }

  /** 无感刷新（API-002 契约）：读 httpOnly Cookie refresh_token → 查账号 → 重新签发 Access + 新 Refresh（轮换） */
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Query('domain') domain: 'platform' | 'tenant' = 'platform',
    @Res({ passthrough: true }) res: Response,
  ) {
    // 手动解析 Cookie 头（未启用 cookie-parser 中间件，不引入额外依赖）
    const token = (req.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim())
      .find((c) =>
        c.startsWith(
          `${domain === 'tenant' ? 'tenant' : 'platform'}_refresh_token=`,
        ),
      )
      ?.split('=')[1];
    if (!token)
      return {
        code: 40101,
        message: '未登录（缺少 refresh_token）',
        data: null,
      };
    try {
      const payload = this.auth.readRefreshToken(token);
      if (payload.domain !== domain) {
        this.clearRefreshCookie(res, domain);
        return { code: 40102, message: '登录已过期，请重新登录', data: null };
      }
      let rotated: { accessToken: string; refreshToken: string };
      let sessionTimeoutMinutes: number | null = null;
      if (payload.domain === 'tenant') {
        const account = await this.accounts.findOne({
          where: {
            id: payload.sub,
            tenantId: payload.tenantId,
            status: 'ACTIVE',
          },
        });
        if (!account) {
          this.clearRefreshCookie(res, domain);
          return { code: 40102, message: '登录已过期，请重新登录', data: null };
        }
        const tenant = await this.tenants.findOne({
          where: { id: account.tenantId, status: 'ACTIVE' },
        });
        if (!tenant) {
          this.clearRefreshCookie(res, domain);
          return { code: 40102, message: '租户已停用，请重新登录', data: null };
        }
        const security = tenantSecurityPolicy(tenant.config);
        if (
          security.ipWhitelistEnabled &&
          !isIpAllowed(this.clientIp(req), security.ipWhitelist)
        ) {
          this.clearRefreshCookie(res, domain);
          return {
            code: 40303,
            message: '当前 IP 不在租户登录白名单中',
            data: null,
          };
        }
        sessionTimeoutMinutes = security.sessionTimeoutMinutes;
        if ((payload.sessionVersion ?? 0) !== (account.sessionVersion ?? 0)) {
          this.clearRefreshCookie(res, domain);
          return { code: 40102, message: '密码已变更，请重新登录', data: null };
        }
        const access = await this.roles.accessForAccount(account);
        if (!access) {
          this.clearRefreshCookie(res, domain);
          return {
            code: 40102,
            message: '账号角色已禁用或失效，请重新登录',
            data: null,
          };
        }
        rotated = this.auth.rotateVerifiedPayload(
          this.tenantAuthPayload(access, security),
        );
      } else {
        const account = await this.platformIdentities.activeSession(
          payload.sub,
        );
        if (!account) {
          this.clearRefreshCookie(res, domain);
          return { code: 40102, message: '登录已过期，请重新登录', data: null };
        }
        rotated = this.auth.rotateVerifiedPayload(
          this.platformIdentities.toAuthPayload(account),
        );
      }
      const { accessToken, refreshToken } = rotated;
      res.cookie(
        `${domain === 'tenant' ? 'tenant' : 'platform'}_refresh_token`,
        refreshToken,
        this.refreshCookieOptions(sessionTimeoutMinutes),
      );
      return {
        code: 0,
        message: 'success',
        data: { access_token: accessToken },
      };
    } catch {
      this.clearRefreshCookie(res, domain);
      return { code: 40102, message: '登录已过期，请重新登录', data: null };
    }
  }

  /** 退出当前认证域，立即清除浏览器中的 httpOnly 刷新凭据。 */
  @Post('logout')
  logout(
    @Query('domain') domain: 'platform' | 'tenant' = 'platform',
    @Res({ passthrough: true }) res: Response,
  ) {
    this.clearRefreshCookie(res, domain);
    return { code: 0, message: '已退出登录', data: null };
  }

  private tenantAuthPayload(
    access: TenantAccountAccess,
    security = tenantSecurityPolicy(undefined),
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
      mustChangePassword: access.account.mustChangePassword,
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

  private clearRefreshCookie(
    res: Response,
    domain: 'platform' | 'tenant',
  ): void {
    const options = this.refreshCookieOptions();
    delete options.maxAge;
    res.clearCookie(
      `${domain === 'tenant' ? 'tenant' : 'platform'}_refresh_token`,
      options,
    );
  }

  private clientIp(req: Request): string {
    const ip = req.ip || req.socket.remoteAddress || '0.0.0.0';
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  }

  private loginAttemptPolicy(security: TenantSecurityPolicy) {
    return {
      maxAttempts: security.lockMaxAttempts,
      windowMs: security.lockMinutes * 60_000,
      lockMs: security.lockMinutes * 60_000,
    };
  }

  private async logPlatformLogin(
    account: string | undefined,
    ip: string,
    result: '成功' | '失败',
  ): Promise<void> {
    await this.logs
      .save(
        this.logs.create({
          account: account ?? '',
          domain: 'platform',
          ip,
          result,
        }),
      )
      .catch(() => undefined);
  }
}

// 载荷类型引用（避免循环依赖）
type AuthPayload = import('./auth.service').AuthPayload;
