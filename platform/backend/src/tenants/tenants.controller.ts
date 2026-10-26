import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantsService } from './tenants.service';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { LifecycleVerifyDto } from '../common/lifecycle/verify.dto';
import { Plan } from '../plans/plan.entity';
import { Robot } from '../robots/robot.entity';
import { User } from '../users/user.entity';
import { KnowledgeBase } from '../knowledge/knowledge-base.entity';
import { Channel } from '../channels/channel.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { ActivationEmailService } from './activation-email.service';
import { AuthService } from '../auth/auth.service';
import { ConfigService } from '@nestjs/config';
import { quotaAlertLevel } from '../common/quota.util';
import type { AuthPayload } from '../auth/auth.service';
import { LoginAttemptLimiter } from '../auth/login-attempt-limiter.service';

type AuthenticatedRequest = Request & { auth?: AuthPayload };

/** 平台侧租户管理 API（FR-001）——真实数据层，对应 04 原型 tenants.html */
@Controller('api/v1/admin/tenants')
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly lifecycle: TenantLifecycleService,
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    @InjectRepository(Robot) private readonly robots: Repository<Robot>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(KnowledgeBase) private readonly kbs: Repository<KnowledgeBase>,
    @InjectRepository(Channel) private readonly channels: Repository<Channel>,
    @InjectRepository(AuditLog) private readonly audits: Repository<AuditLog>,
    private readonly email: ActivationEmailService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly loginAttempts: LoginAttemptLimiter,
  ) {}

  /** 租户列表（平台侧全租户视图，聚合套餐名/资源/本月调用/额度） */
  @Get()
  async list() {
    const list = await this.tenants.list();
    const pMap = new Map((await this.plans.find()).map((p) => [p.id, p]));
    return Promise.all(list.map(async (t) => {
      const plan = pMap.get(t.planId);
      const [robotCount, userCount, kbCount] = await Promise.all([
        this.robots.count({ where: { tenantId: t.id } }),
        this.users.count({ where: { tenantId: t.id } }),
        this.kbs.count({ where: { tenantId: t.id } }),
      ]);
      return {
        ...t,
        planName: plan?.name ?? '—',
        robotCount,
        userCount,
        kbCount,
        monthCalls: t.aiQuotaUsed,
        quotaUsedPct: plan && plan.aiQuota > 0 ? Math.round((t.aiQuotaUsed / plan.aiQuota) * 100) : 0,
        quotaAlertLevel: plan ? quotaAlertLevel(t.config, t.aiQuotaUsed, plan.aiQuota) : undefined,
      };
    }));
  }

  /** 开通新租户，同时生成首个管理员与一次性临时密码。 */
  @Post()
  async create(@Body() body: { name: string; adminEmail: string; planId: string; trial?: boolean }) {
    const { tenant, initialCredentials } = await this.tenants.create(body);
    return {
      ...tenant,
      nextStep: 'assign-dify-resources',
      initialCredentials,
    };
  }

  /** 租户详情（聚合：套餐/资源/本月用量/操作日志，对齐原型 tenant-detail.html） */
  @Get(':id')
  async detail(@Param('id') id: string) {
    const tenant = await this.tenants.findById(id);
    let plan = null;
    try { plan = await this.plans.findOne({ where: { id: tenant.planId } }); } catch { plan = null; }
    const [robots, users, kbs, channels, auditLogs] = await Promise.all([
      this.robots.find({ where: { tenantId: id } }),
      this.users.count({ where: { tenantId: id } }),
      this.kbs.count({ where: { tenantId: id } }),
      this.channels.count({ where: { tenantId: id } }),
      this.audits.find({ where: { tenantId: id }, order: { createdAt: 'DESC' }, take: 20 }),
    ]);
    return {
      ...tenant,
      planName: plan?.name ?? '—',
      plan,
      resource: {
        robots: robots.map((r) => ({ id: r.id, name: r.name, status: r.status })),
        robotCount: robots.length,
        publishedRobots: robots.filter((r) => r.status === 'PUBLISHED').length,
        draftRobots: robots.filter((r) => r.status === 'DRAFT').length,
        userCount: users,
        kbCount: kbs,
        channelCount: channels,
        monthCalls: tenant.aiQuotaUsed,
        quotaUsedPct: plan && plan.aiQuota > 0 ? Math.round((tenant.aiQuotaUsed / plan.aiQuota) * 100) : 0,
        quotaAlertLevel: plan ? quotaAlertLevel(tenant.config, tenant.aiQuotaUsed, plan.aiQuota) : undefined,
      },
      // 操作日志：配置类审计（question 以 [ 开头 = 平台/设置操作）
      logs: auditLogs
        .filter((a) => a.question.startsWith('['))
        .map((a) => ({
          id: a.id,
          time: a.createdAt,
          operator: a.channelUserId ?? 'admin',
          module: a.question.split(']')[0].replace('[', ''),
          action: a.question.split(']')[1]?.trim() ?? a.question,
          detail: a.answer ?? a.result,
          traceId: a.traceId,
        })),
    };
  }

  /** 禁用（正反向验证必带） */
  @Post(':id/disable')
  async disable(@Param('id') id: string, @Body() body: { verify: LifecycleVerifyDto; reason?: string }) {
    const impact = await this.lifecycle.calculateImpact(id);
    return { ...(await this.lifecycle.disable(id, body.verify, body.reason)), impact };
  }

  /** 恢复 */
  @Post(':id/restore')
  async restore(@Param('id') id: string, @Body() body: { verify: LifecycleVerifyDto }) {
    return this.lifecycle.restore(id, body.verify);
  }

  /** 发送真实激活邮件：24 小时签名链接，SMTP 未配置时失败且不写成功审计。 */
  @Post(':id/send-activation')
  async sendActivation(@Param('id') id: string) {
    const tenant = await this.tenants.findById(id);
    const token = this.auth.issueActivationToken(tenant.id, tenant.adminEmail);
    const publicAppUrl = this.config.get<string>('PUBLIC_APP_URL');
    if (!publicAppUrl) throw new ServiceUnavailableException({ code: 50301, message: 'PUBLIC_APP_URL 尚未配置，激活邮件未发送', data: null });
    const appUrl = publicAppUrl.replace(/\/$/, '');
    await this.email.send(tenant.adminEmail, tenant.name, `${appUrl}/tenant-activate?token=${encodeURIComponent(token)}`);
    await this.audits.save(this.audits.create({
      tenantId: id,
      question: `[激活] 发送激活邮件（${tenant.adminEmail}）`,
      result: 'SMTP 已接受邮件',
    })).catch(() => undefined);
    return { code: 0, message: '激活邮件已发送', data: { ok: true } };
  }

  /** 平台代重置租户主管理员密码，仅 tenants 窗口权限可调用。 */
  @Post(':id/reset-admin-password')
  async resetAdminPassword(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { password: string },
  ) {
    const result = await this.tenants.resetAdminPassword(
      id,
      body?.password,
      req.auth?.name ?? req.auth?.sub,
    );
    this.loginAttempts.resetAccount('tenant', result.account);
    return {
      code: 0,
      message: '租户管理员临时密码已重置',
      data: result,
    };
  }

  /** 删除（级联 + 正反向验证） */
  @Delete(':id')
  async remove(@Param('id') id: string, @Body() body: { verify: LifecycleVerifyDto }) {
    return this.lifecycle.remove(id, body.verify);
  }

  /** 换套餐（30 天补价，服务端权威计算 + 周期更新） */
  @Post(':id/change-plan')
  async changePlan(@Param('id') id: string, @Body() body: { planId: string; effectType: 'IMMEDIATE' | 'NEXT_CYCLE' }) {
    return this.tenants.changePlan(id, body);
  }
}
