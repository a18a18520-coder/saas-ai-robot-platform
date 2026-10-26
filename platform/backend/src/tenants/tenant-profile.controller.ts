import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from './tenant.entity';
import { Plan } from '../plans/plan.entity';
import { Robot } from '../robots/robot.entity';
import { User } from '../users/user.entity';
import { KnowledgeBase } from '../knowledge/knowledge-base.entity';
import { Channel } from '../channels/channel.entity';
import { AuditService } from '../audit/audit.service';
import { SubscriptionService } from '../plans/subscription.service';
import {
  isIpAllowed,
  serializeTenantSecurityPolicy,
} from './tenant-security-policy';

/** 租户设置（对齐原型 settings.html）：基本信息 / 套餐与额度 / 管理人员 / 安全策略 */
@Controller('api/v1/tenant/profile')
export class TenantProfileController {
  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    private readonly audit: AuditService,
    private readonly subscriptions?: SubscriptionService,
  ) {}

  /** 租户信息 + 套餐 + 偏好 + 当前计费周期真实调用 */
  @Get()
  async profile(@Query('tenantId') tenantId: string) {
    await this.subscriptions?.activateDue(tenantId);
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) return { code: 40401, message: '租户不存在', data: null };
    let plan = null;
    try {
      plan = await this.plans.findOne({ where: { id: tenant.planId } });
    } catch {
      plan = null;
    }
    const plans = await this.plans.find({ where: { isActive: true } });
    // 由 AI 路由在发起模型请求前原子扣减，周期续费时清零。
    const monthCalls = tenant.aiQuotaUsed;
    const [robots, users, knowledgeBases, channels] = await Promise.all(
      [Robot, User, KnowledgeBase, Channel].map(entity =>
        this.tenants.manager.getRepository(entity).count({ where: { tenantId } })),
    );
    return {
      code: 0,
      message: 'success',
      data: {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          status: tenant.status,
          adminEmail: tenant.adminEmail,
          cycleStartAt: tenant.cycleStartAt,
          subscriptionEnd: tenant.subscriptionEnd,
          pendingSubscription: tenant.pendingSubscription ? { planId: tenant.pendingSubscription.planId, start: tenant.pendingSubscription.start, end: tenant.pendingSubscription.end } : null,
          aiQuotaUsed: tenant.aiQuotaUsed,
          monthCalls,
          isTrial: tenant.isTrial,
          createdAt: tenant.createdAt,
        },
        plan,
        plans,
        preferences: tenant.config ?? {},
        resourceUsage: { robots, users, knowledgeBases, channels, ...(await this.subscriptions?.usage(tenantId) ?? {}) },
      },
    };
  }

  /** 保存偏好（额度预警阈值/通知方式） */
  @Put('preferences')
  async savePreferences(
    @Req() req: Request,
    @Query('tenantId') tenantId: string,
    @Body() body: { preferences: Record<string, unknown> },
  ) {
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) return { code: 40401, message: '租户不存在', data: null };
    const incoming = body.preferences ?? {};
    if ('notifyWays' in incoming && (!Array.isArray(incoming.notifyWays) || incoming.notifyWays.length !== 1 || incoming.notifyWays[0] !== '站内通知')) {
      throw new BadRequestException('目前额度预警仅支持站内通知，邮件和企微尚未接通');
    }
    if ('notifyTarget' in incoming && incoming.notifyTarget !== '租户通知中心') {
      throw new BadRequestException('目前额度预警发送至租户通知中心，暂不支持指定人员');
    }
    const nextConfig = { ...(tenant.config ?? {}), ...incoming };
    if ('security' in incoming) {
      try {
        const security = serializeTenantSecurityPolicy(
          (incoming.security ?? {}) as Record<string, unknown>,
        );
        const clientIp = this.clientIp(req);
        if (
          security.ipWhitelistEnabled &&
          !isIpAllowed(clientIp, security.ipWhitelist)
        ) {
          throw new Error(
            `当前访问 IP（${clientIp}）不在白名单中，为避免管理员被锁在系统外，本次设置未保存`,
          );
        }
        nextConfig.security = security;
      } catch (error) {
        throw new BadRequestException({
          code: 40002,
          message: error instanceof Error ? error.message : '安全策略配置无效',
          data: null,
        });
      }
    }
    if ('threshold1' in incoming || 'threshold2' in incoming) {
      const reminder = Number(nextConfig.threshold1 ?? 80);
      const strong = Number(nextConfig.threshold2 ?? 90);
      if (
        ![60, 70, 80, 90].includes(reminder) ||
        ![80, 90, 95, 100].includes(strong) ||
        reminder >= strong
      ) {
        throw new BadRequestException({
          code: 40002,
          message: '额度提醒阈值必须小于强提醒阈值',
          data: null,
        });
      }
    }
    tenant.config = nextConfig;
    await this.tenants.save(tenant);
    await this.audit.log({
      tenantId,
      question: `[设置] 更新${'security' in incoming ? '安全策略' : '额度预警偏好'}`,
      result: '设置更新',
    });
    return { code: 0, message: 'success', data: tenant.config };
  }

  private clientIp(req: Request): string {
    const ip = req.ip || req.socket.remoteAddress || '0.0.0.0';
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  }
}
