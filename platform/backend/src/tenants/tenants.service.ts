import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';
import { Tenant } from './tenant.entity';
import { PlanPriceService } from '../plans/plan-price.service';
import { PlansService } from '../plans/plans.service';
import { PaymentOrder } from '../payments/payment-order.entity';
import { Notification } from '../notifications/notification.entity';
import { AuditService } from '../audit/audit.service';
import { Role, RolePermission } from '../roles/role.entity';
import { localDateISO } from '../common/date.util';
import { PaymentGatewayService } from '../payments/payment-gateway.service';
import { randomBytes } from 'crypto';
import { TenantAccount } from './tenant-account.entity';
import { hashPassword } from '../auth/password.util';
import {
  BUILTIN_TENANT_ROLE_WINDOWS,
  generateTenantInitialPassword,
  TENANT_ADMIN_WINDOWS,
} from './tenant-account.defaults';
import { passwordPolicyError, tenantSecurityPolicy } from './tenant-security-policy';
import { addDays, subscriptionEnd, applyPaidOrder } from '../plans/subscription';

export interface TenantInitialCredentials {
  account: string;
  password: string;
  mustChangePassword: true;
}

/** 租户管理（FR-001 平台侧）——真实 CRUD + 初始管理员 + 换套餐 */
@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant) private readonly repo: Repository<Tenant>,
    private readonly price: PlanPriceService,
    private readonly plans: PlansService,
    @InjectRepository(PaymentOrder) private readonly orders: Repository<PaymentOrder>,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    private readonly audit: AuditService,
    private readonly paymentGateway: PaymentGatewayService,
    @InjectRepository(TenantAccount)
    private readonly tenantAccounts: Repository<TenantAccount>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** 全租户列表（平台侧视图，含套餐/用量聚合） */
  async list(): Promise<Tenant[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  /** 开通新租户：事务内创建租户与首个管理员，并仅在响应中返回一次临时密码。 */
  async create(data: {
    name: string;
    adminEmail: string;
    planId: string;
    trial?: boolean;
  }): Promise<{
    tenant: Tenant;
    initialCredentials: TenantInitialCredentials;
  }> {
    const name = data.name?.trim();
    const adminEmail = data.adminEmail?.trim().toLowerCase();
    const planId = data.planId?.trim();
    if (!name || !adminEmail || !planId) {
      throw new BadRequestException({
        code: 40001,
        message: '租户名称、管理员账号和套餐必填',
        data: null,
      });
    }

    const selectedPlan = await this.plans.findById(planId);
    if (!selectedPlan.isActive) throw new HttpException('套餐未启用', 422);
    const initialPassword = generateTenantInitialPassword();
    const saved = await this.dataSource.transaction(async (manager) => {
      const tenants = manager.getRepository(Tenant);
      const accounts = manager.getRepository(TenantAccount);
      const roles = manager.getRepository(Role);
      const permissions = manager.getRepository(RolePermission);
      const existing = await accounts.findOne({
        where: { account: ILike(adminEmail) },
      });
      if (existing) {
        throw new ConflictException({
          code: 40901,
          message: '管理员登录账号已存在',
          data: null,
        });
      }

      const tenant = await tenants.save(
        tenants.create({
          name,
          adminEmail,
          planId,
          status: 'ACTIVE',
          cycleStartAt: localDateISO(),
          subscriptionEnd: addDays(localDateISO(), selectedPlan.validityDays || 30),
          isTrial: data.trial ?? false,
        }),
      );
      let administratorRole: Role | undefined;
      for (const [roleName, windows] of Object.entries(BUILTIN_TENANT_ROLE_WINDOWS)) {
        const role = await roles.save(roles.create({
          tenantId: tenant.id,
          name: roleName,
          isBuiltin: true,
          status: 'ACTIVE',
        }));
        if (roleName === '管理员') administratorRole = role;
        for (const resourceId of windows) {
          await permissions.save(permissions.create({
            roleId: role.id,
            resourceType: 'window',
            resourceId,
          }));
        }
      }
      if (!administratorRole) throw new Error('租户管理员角色初始化失败');
      const account = await accounts.save(
        accounts.create({
          tenantId: tenant.id,
          name: '租户管理员',
          account: adminEmail,
          passwordHash: hashPassword(initialPassword),
          role: 'TENANT_ADMIN',
          roleId: administratorRole.id,
          windows: [...TENANT_ADMIN_WINDOWS],
          status: 'ACTIVE',
          sessionVersion: 0,
          mustChangePassword: true,
          passwordChangedAt: new Date(),
        }),
      );
      tenant.adminAccountId = account.id;
      return tenants.save(tenant);
    });

    await this.audit
      .log({
        tenantId: saved.id,
        question: '[开通] 租户与主管理员账号创建',
        result: 'ACTIVE · 临时初始密码已生成（首次登录必须修改）',
      })
      .catch(() => undefined);
    await this.notifications.save(this.notifications.create({
      tenantId: 'platform',
      type: 'system',
      title: '新租户待分配 Dify 资源',
      content: `租户「${saved.name}」（${saved.adminEmail}）及主管理员已创建，套餐 ${planId.slice(0, 8)}…，请继续分配 Dify 资源`,
      link: '/tenants',
    })).catch(() => undefined);
    return {
      tenant: saved,
      initialCredentials: {
        account: adminEmail,
        password: initialPassword,
        mustChangePassword: true,
      },
    };
  }

  async findById(id: string): Promise<Tenant> {
    const tenant = await this.repo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException('40401: 租户不存在');
    return tenant;
  }

  /** 平台代重置租户主管理员密码，旧刷新凭据立即失效。 */
  async resetAdminPassword(
    id: string,
    password: string,
    operator?: string,
  ): Promise<{
    ok: true;
    account: string;
    sessionsRevoked: true;
    mustChangePassword: true;
  }> {
    const tenant = await this.findById(id);
    const passwordError = passwordPolicyError(password, tenantSecurityPolicy(tenant.config));
    if (passwordError) {
      throw new BadRequestException({ code: 40002, message: passwordError, data: null });
    }
    if (tenant.status === 'DELETED') {
      throw new ConflictException({
        code: 40902,
        message: '已删除的租户不能重置管理员密码',
        data: null,
      });
    }

    let account = tenant.adminAccountId
      ? await this.tenantAccounts.findOne({
          where: { id: tenant.adminAccountId, tenantId: id },
        })
      : null;
    if (!account) {
      account = await this.tenantAccounts.findOne({
        where: { tenantId: id, account: ILike(tenant.adminEmail) },
      });
    }
    if (!account) {
      account = await this.tenantAccounts.findOne({
        where: { tenantId: id, role: 'TENANT_ADMIN' },
        order: { createdAt: 'ASC' },
      });
    }
    if (!account) {
      throw new ConflictException({
        code: 40902,
        message: '该租户尚未完成管理员激活，暂无可重置的账号',
        data: null,
      });
    }

    account.passwordHash = hashPassword(password);
    account.sessionVersion = (account.sessionVersion ?? 0) + 1;
    account.mustChangePassword = true;
    account.passwordChangedAt = new Date();
    await this.tenantAccounts.save(account);
    if (tenant.adminAccountId !== account.id) {
      tenant.adminAccountId = account.id;
      await this.repo.save(tenant);
    }
    await this.audit
      .log({
        tenantId: tenant.id,
        channelUserId: operator,
        question: `[账号] 平台重置租户管理员密码（${account.account}）`,
        result: '临时密码已重置，旧刷新会话已失效，下次登录必须修改密码',
      })
      .catch(() => undefined);
    return {
      ok: true,
      account: account.account,
      sessionsRevoked: true,
      mustChangePassword: true,
    };
  }

  /** 换套餐：真实补价计算 + 更新周期（IMMEDIATE：今天起 30 天新周期） */
  async changePlan(id: string, body: { planId: string; effectType: 'IMMEDIATE' | 'NEXT_CYCLE' }) {
    const tenant = await this.findById(id);
    const [oldPlan, newPlan] = await Promise.all([this.plans.findById(tenant.planId), this.plans.findById(body.planId)]);
    if (!newPlan.isActive) throw new HttpException({ code: 42201, message: `套餐「${newPlan.name}」未启用`, data: null }, HttpStatus.UNPROCESSABLE_ENTITY);
    // 降级（新价 < 旧价）：当前套餐到期前禁止降级（与租户侧 payments 一致）
    const expired = subscriptionEnd(tenant, oldPlan) <= localDateISO();
    if (tenant.pendingSubscription) throw new HttpException('已有已支付的下周期套餐，不能覆盖', 409);
    if (!['IMMEDIATE', 'NEXT_CYCLE'].includes(body.effectType)) throw new HttpException('生效方式无效', 400);
    if (!expired && body.effectType === 'IMMEDIATE' && newPlan.id === oldPlan.id) throw new HttpException('续费请选择下周期生效', 409);
    if (!expired && body.effectType === 'IMMEDIATE' && newPlan.price < oldPlan.price) {
      throw new HttpException(
        { code: 42201, message: `当前套餐「${oldPlan.name}」未到期，到期后方可降级至「${newPlan.name}」`, data: null },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const usedDays = this.daysSince(tenant.cycleStartAt);
    const diff = this.price.calculateDiff({
      oldPlanPrice: oldPlan.price,
      newPlanPrice: newPlan.price,
      usedDays,
      effectType: body.effectType,
      oldValidityDays: oldPlan.validityDays, newValidityDays: newPlan.validityDays,
    });

    if (body.effectType === 'NEXT_CYCLE' || expired) diff.diff = newPlan.price;
    {
      if (diff.diff > 0) {
        // 需补差 → 生成账单（微信/支付宝/对公核销 FR-029），支付确认后套餐生效（复用租户侧 payments confirm 链路）
        const merchantOrderNo = `S${Date.now().toString(36)}${randomBytes(5).toString('hex')}`.toUpperCase();
        const amount = Math.round(diff.diff * 100);
        const qrContent = await this.paymentGateway.createNativeOrder('WECHAT', merchantOrderNo, amount, `购买${newPlan.name}`);
        const order = await this.orders.save(this.orders.create({
          tenantId: tenant.id,
          planId: newPlan.id,
          planName: newPlan.name,
          amount,
          entitlement: { effectType: body.effectType, validityDays: newPlan.validityDays, basePlanId: tenant.planId, baseCycle: tenant.cycleStartAt, baseEnd: tenant.subscriptionEnd },
          payType: 'WECHAT',
          qrContent,
          merchantOrderNo,
          status: 'PENDING',
        }));
        await this.audit.log({
          tenantId: tenant.id,
          question: `[套餐] 换套餐（${oldPlan.name} → ${newPlan.name}）`,
          result: `应补差价 ¥${diff.diff.toFixed(2)}，订单待支付（${order.id.slice(0, 8)}…）`,
        }).catch(() => undefined);
        return { tenant, priceDiff: diff, order };
      }
      // 免付（差价 ≤ 0）→ 直接切换 + 重置周期
      await this.repo.manager.transaction(async manager => {
        const current = await manager.findOne(Tenant, { where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!current) throw new HttpException('租户不存在', 404);
        const order = manager.create(PaymentOrder, { tenantId: id, planId: newPlan.id, planName: newPlan.name, amount: 0, payType: 'BANK_TRANSFER', status: 'PAID', paidAt: new Date(), entitlement: { effectType: body.effectType, validityDays: newPlan.validityDays, basePlanId: tenant.planId, baseCycle: tenant.cycleStartAt, baseEnd: tenant.subscriptionEnd } });
        await manager.save(order); applyPaidOrder(current, order); await manager.save(current); Object.assign(tenant, current);
      });
      await this.audit.log({
        tenantId: tenant.id,
        question: `[套餐] 换套餐（${oldPlan.name} → ${newPlan.name}）`,
        result: `免付直接切换（已用 ${usedDays} 天，差价 ≤ 0）`,
      }).catch(() => undefined);
    }
    return { tenant, priceDiff: diff };
  }

  private daysSince(dateStr: string): number {
    // 本地时区解析日期字符串（UTC 解析会差 8h 导致天数偏差）
    const [y, m, d] = dateStr.split('-').map(Number);
    return Math.floor((Date.now() - new Date(y, m - 1, d).getTime()) / 86_400_000);
  }
}
