import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import type { AuthPayload } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoginLog } from '../tenants/tenant-account.entity';
import { PlatformIdentityService } from './platform-identity.service';

type AuthenticatedRequest = Request & { auth?: AuthPayload };

/** 平台账号与角色管理：仅固定超管可执行。 */
@Controller('api/v1/admin/platform')
export class PlatformIdentityController {
  constructor(
    private readonly identities: PlatformIdentityService,
    private readonly audit: AuditService,
    @InjectRepository(LoginLog)
    private readonly loginLogs: Repository<LoginLog>,
  ) {}

  @Get('roles')
  listRoles(@Req() req: AuthenticatedRequest) {
    this.assertSuperAdmin(req);
    return this.identities.listRoles();
  }

  @Post('roles')
  async createRole(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: { name: string; description?: string; permissions?: unknown[] },
  ) {
    this.assertSuperAdmin(req);
    const role = await this.identities.createRole(body);
    await this.log(
      req,
      '新建平台角色',
      `${role.name} · ${role.permissions.length} 个窗口`,
    );
    return role;
  }

  @Patch('roles/:id')
  async updateRole(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: { name?: string; description?: string; permissions?: unknown[] },
  ) {
    this.assertSuperAdmin(req);
    const role = await this.identities.updateRole(id, body);
    await this.log(
      req,
      '更新平台角色',
      `${role.name} · ${role.permissions.length} 个窗口`,
    );
    return role;
  }

  @Delete('roles/:id')
  async removeRole(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    this.assertSuperAdmin(req);
    await this.identities.removeRole(id);
    await this.log(req, '删除平台角色', id);
    return { ok: true };
  }

  @Get('accounts')
  listAccounts(@Req() req: AuthenticatedRequest) {
    this.assertSuperAdmin(req);
    return this.identities.listAccounts();
  }

  @Get('login-logs')
  listLoginLogs(@Req() req: AuthenticatedRequest) {
    this.assertSuperAdmin(req);
    return this.loginLogs.find({
      where: { domain: 'platform' },
      order: { createdAt: 'DESC' },
      take: 30,
    });
  }

  @Post('accounts')
  async createAccount(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: { name: string; account: string; password: string; roleId: string },
  ) {
    this.assertSuperAdmin(req);
    const account = await this.identities.createAccount(body);
    await this.log(
      req,
      '新增平台账号',
      `${account.account} · ${account.roleName}`,
    );
    return account;
  }

  @Patch('accounts/:id')
  async updateAccount(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      roleId?: string;
      status?: 'ACTIVE' | 'DISABLED';
      password?: string;
    },
  ) {
    this.assertSuperAdmin(req);
    const account = await this.identities.updateAccount(id, body);
    await this.log(
      req,
      '更新平台账号',
      `${account.account} · ${account.roleName} · ${account.status}`,
    );
    return account;
  }

  @Delete('accounts/:id')
  async removeAccount(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    this.assertSuperAdmin(req);
    await this.identities.removeAccount(id);
    await this.log(req, '删除平台账号', id);
    return { ok: true };
  }

  private assertSuperAdmin(req: AuthenticatedRequest): void {
    if (req.auth?.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('仅平台超级管理员可管理账号与角色');
    }
  }

  private async log(
    req: AuthenticatedRequest,
    action: string,
    result: string,
  ): Promise<void> {
    await this.audit
      .log({
        tenantId: 'platform',
        channelUserId: req.auth?.sub,
        question: `[平台权限] ${action}`,
        result: `${req.auth?.name ?? '超级管理员'} · ${result}`,
      })
      .catch(() => undefined);
  }
}
