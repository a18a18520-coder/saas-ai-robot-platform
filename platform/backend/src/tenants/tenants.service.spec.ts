import { HttpException } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { Tenant } from './tenant.entity';
import { PlanPriceService } from '../plans/plan-price.service';
import { Plan } from '../plans/plan.entity';
import { verifyPassword } from '../auth/password.util';
import { Role, RolePermission } from '../roles/role.entity';

/** 依赖 mock：Tenant repo + PlansService + PaymentOrder repo + Notification repo + AuditService；PlanPriceService 用真实实现 */
const tenant = (over: Partial<Tenant> = {}): Tenant => ({
  id: 't-1', name: '验证科技', planId: 'old-plan', status: 'ACTIVE',
  cycleStartAt: '2026-08-21', adminEmail: 'admin@x.com',
  aiQuotaUsed: 0, isTrial: false, createdAt: new Date(), config: {},
  ...over,
} as Tenant);

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'p-x', name: '套餐X', price: 1000, validityDays: 30,
  robotLimit: 5, userLimit: 200, kbLimit: 5, aiQuota: 3000,
  fileSizeLimitMb: 0, storageLimitMb: 512, channelLimit: 2, adminWindowLimit: 1,
  isActive: true, isFeatured: false,
  ...over,
} as Plan);

const repoMock = { create: jest.fn(), save: jest.fn(), findOne: jest.fn(), find: jest.fn() };
const plansMock = { findById: jest.fn() };
const ordersMock = { create: jest.fn(), save: jest.fn() };
const notificationsMock = { create: jest.fn(), save: jest.fn(() => Promise.resolve({})) };
const auditMock = { log: jest.fn(() => Promise.resolve({})) };
const paymentGatewayMock = { createNativeOrder: jest.fn(async () => 'weixin://wxpay/test-order') };
const tenantAccountsMock = { findOne: jest.fn(), save: jest.fn() };
const transactionTenantRepo = { create: jest.fn(), save: jest.fn() };
const transactionAccountRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
};
const transactionRoleRepo = { create: jest.fn(), save: jest.fn() };
const transactionPermissionRepo = { create: jest.fn(), save: jest.fn() };
const dataSourceMock = { transaction: jest.fn() };

describe('TenantsService', () => {
  let svc: TenantsService;

  beforeEach(() => {
    jest.clearAllMocks();
    // 冻结「今天」= 2026-08-31（daysSince 依赖 Date.now，测试 fixture cycleStartAt 基于此）
    jest.useFakeTimers().setSystemTime(new Date('2026-08-31T10:00:00'));
    plansMock.findById.mockResolvedValue(plan());
    transactionTenantRepo.create.mockImplementation((value) => value);
    transactionTenantRepo.save.mockImplementation(async (value) =>
      value.id ? value : { ...value, id: 't-new' },
    );
    transactionAccountRepo.create.mockImplementation((value) => value);
    transactionAccountRepo.save.mockImplementation(async (value) => ({
      ...value,
      id: value.id ?? 'account-new',
    }));
    transactionAccountRepo.findOne.mockResolvedValue(null);
    transactionRoleRepo.create.mockImplementation((value) => value);
    transactionRoleRepo.save.mockImplementation(async (value) => ({ ...value, id: `role-${value.name}` }));
    transactionPermissionRepo.create.mockImplementation((value) => value);
    transactionPermissionRepo.save.mockImplementation(async (value) => value);
    dataSourceMock.transaction.mockImplementation(async (work) =>
      work({
        getRepository: (entity: unknown) => {
          if (entity === Tenant) return transactionTenantRepo;
          if (entity === Role) return transactionRoleRepo;
          if (entity === RolePermission) return transactionPermissionRepo;
          return transactionAccountRepo;
        },
      }),
    );
    svc = new TenantsService(repoMock as any, new PlanPriceService(), plansMock as any, ordersMock as any, notificationsMock as any, auditMock as any, paymentGatewayMock as any, tenantAccountsMock as any, dataSourceMock as any);
  });

  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  describe('changePlan — 真实补价链路（API-005）', () => {
    it('升级补差：真实价格计算 + 生成 PENDING 订单 + 套餐不提前切换', async () => {
      repoMock.findOne.mockResolvedValue(tenant({ planId: 'old-plan' }));
      plansMock.findById.mockResolvedValueOnce(plan({ id: 'old-plan', name: '标准版', price: 1000 })) // 旧套餐
        .mockResolvedValueOnce(plan({ id: 'new-plan', name: '专业版', price: 2000 })); // 新套餐
      ordersMock.create.mockImplementation((o) => o);
      ordersMock.save.mockImplementation(async (o) => ({ ...o, id: 'order-1' }));

      const r = await svc.changePlan('t-1', { planId: 'new-plan', effectType: 'IMMEDIATE' });

      // 真实补价：2000 − 1000÷30×10（2026-08-21 → 10 天）
      expect(r.priceDiff.oldPrice).toBe(1000);
      expect(r.priceDiff.diff).toBeCloseTo(1666.67, 2);
      // 生成账单（分）
      expect(r.order).toMatchObject({ tenantId: 't-1', planId: 'new-plan', amount: Math.round(1666.67 * 100), status: 'PENDING' });
      expect(paymentGatewayMock.createNativeOrder).toHaveBeenCalledWith('WECHAT', expect.any(String), Math.round(1666.67 * 100), '购买专业版');
      // 套餐未切换（支付确认后生效）
      expect(repoMock.save).not.toHaveBeenCalled();
      // 审计
      expect(auditMock.log).toHaveBeenCalledWith(expect.objectContaining({ question: '[套餐] 换套餐（标准版 → 专业版）' }));
    });

    it('到期换套餐按全价购买，不能抵扣上周期已用价值', async () => {
      // 旧套餐 ¥1000 已用满 30 天（周期开始 30 天前）→ 消耗 1000 → 同价新套餐差价 0
      repoMock.findOne.mockResolvedValue(tenant({ planId: 'old-plan', cycleStartAt: '2026-08-01' }));
      plansMock.findById.mockResolvedValueOnce(plan({ id: 'old-plan', name: '标准版', price: 1000 }))
        .mockResolvedValueOnce(plan({ id: 'new-plan', name: '标准版+', price: 1000 }));
      repoMock.save.mockImplementation(async (t) => t);

      const r = await svc.changePlan('t-1', { planId: 'new-plan', effectType: 'IMMEDIATE' });
      expect(r.priceDiff.diff).toBe(1000);
      expect(repoMock.save).not.toHaveBeenCalled();
      expect(ordersMock.save).toHaveBeenCalledWith(expect.objectContaining({ amount: 100000 }));
    });

    it('降级保护：新价 < 旧价 → 42201 未到期禁止降级', async () => {
      repoMock.findOne.mockResolvedValue(tenant({ planId: 'old-plan' }));
      plansMock.findById.mockResolvedValueOnce(plan({ id: 'old-plan', name: '旗舰版', price: 3999 }))
        .mockResolvedValueOnce(plan({ id: 'new-plan', name: '标准版', price: 999 }));
      await expect(svc.changePlan('t-1', { planId: 'new-plan', effectType: 'IMMEDIATE' })).rejects.toThrow('未到期');
      expect(ordersMock.save).not.toHaveBeenCalled();
    });

    it('新套餐未启用 → 42201', async () => {
      repoMock.findOne.mockResolvedValue(tenant({ planId: 'old-plan' }));
      plansMock.findById.mockResolvedValueOnce(plan({ id: 'old-plan', name: '标准版', price: 1000 }))
        .mockResolvedValueOnce(plan({ id: 'new-plan', name: '下架版', price: 2000, isActive: false }));
      await expect(svc.changePlan('t-1', { planId: 'new-plan', effectType: 'IMMEDIATE' })).rejects.toThrow('未启用');
    });

    it('NEXT_CYCLE：生成全价预约订单，付款前不切换', async () => {
      repoMock.findOne.mockResolvedValue(tenant({ planId: 'old-plan' }));
      plansMock.findById.mockResolvedValueOnce(plan({ id: 'old-plan', name: '标准版', price: 1000 }))
        .mockResolvedValueOnce(plan({ id: 'new-plan', name: '专业版', price: 2000 }));
      const r = await svc.changePlan('t-1', { planId: 'new-plan', effectType: 'NEXT_CYCLE' });
      expect(r.priceDiff.diff).toBeGreaterThan(0);
      expect(repoMock.save).not.toHaveBeenCalled();
      expect(ordersMock.save).toHaveBeenCalledWith(expect.objectContaining({ amount: 200000, entitlement: expect.objectContaining({ effectType: 'NEXT_CYCLE' }) }));
    });
  });

  describe('create — 开通租户并生成初始凭据', () => {
    it('事务内创建启用租户与主管理员，仅返回一次临时密码', async () => {
      notificationsMock.create.mockImplementation((n) => n);

      const result = await svc.create({
        name: ' 新租户 ',
        adminEmail: 'Admin@New.com',
        planId: 'p1',
      });

      expect(dataSourceMock.transaction).toHaveBeenCalledTimes(1);
      expect(transactionTenantRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '新租户',
          adminEmail: 'admin@new.com',
          status: 'ACTIVE',
        }),
      );
      const createdAccount = transactionAccountRepo.create.mock.calls[0][0];
      expect(createdAccount).toMatchObject({
        tenantId: 't-new',
        account: 'admin@new.com',
        role: 'TENANT_ADMIN',
        roleId: 'role-管理员',
        status: 'ACTIVE',
        mustChangePassword: true,
      });
      expect(transactionRoleRepo.create).toHaveBeenCalledTimes(5);
      expect(transactionPermissionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ roleId: 'role-管理员', resourceType: 'window', resourceId: 'settings' }),
      );
      expect(
        verifyPassword(
          result.initialCredentials.password,
          createdAccount.passwordHash,
        ),
      ).toBe(true);
      expect(result).toMatchObject({
        tenant: { id: 't-new', status: 'ACTIVE' },
        initialCredentials: {
          account: 'admin@new.com',
          mustChangePassword: true,
        },
      });
      expect(notificationsMock.save).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'platform', title: '新租户待分配 Dify 资源' }));
      expect(auditMock.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-new', question: expect.stringContaining('[开通]') }));
      expect(JSON.stringify(auditMock.log.mock.calls)).not.toContain(
        result.initialCredentials.password,
      );
      expect(JSON.stringify(notificationsMock.save.mock.calls)).not.toContain(
        result.initialCredentials.password,
      );
    });

    it('管理员登录账号重复时事务回滚并返回冲突', async () => {
      transactionAccountRepo.findOne.mockResolvedValue({ id: 'existing' });
      await expect(
        svc.create({
          name: '新租户',
          adminEmail: 'admin@new.com',
          planId: 'p1',
        }),
      ).rejects.toThrow('管理员登录账号已存在');
      expect(transactionTenantRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('resetAdminPassword — 平台重置租户管理员密码', () => {
    it('重置主管理员密码、提升会话版本并写审计', async () => {
      repoMock.findOne.mockResolvedValue(
        tenant({ adminAccountId: 'account-1' }),
      );
      const account = {
        id: 'account-1',
        tenantId: 't-1',
        account: 'admin@x.com',
        passwordHash: 'old-hash',
        role: 'TENANT_ADMIN',
        status: 'ACTIVE',
        sessionVersion: 2,
        mustChangePassword: false,
      };
      tenantAccountsMock.findOne.mockResolvedValue(account);
      tenantAccountsMock.save.mockImplementation(async (value) => value);

      const result = await svc.resetAdminPassword(
        't-1',
        'NewTenant2026',
        '平台运营',
      );

      expect(result).toEqual({
        ok: true,
        account: 'admin@x.com',
        sessionsRevoked: true,
        mustChangePassword: true,
      });
      expect(account.sessionVersion).toBe(3);
      expect(account.mustChangePassword).toBe(true);
      expect(verifyPassword('NewTenant2026', account.passwordHash)).toBe(true);
      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't-1',
          channelUserId: '平台运营',
          question: expect.stringContaining('重置租户管理员密码'),
        }),
      );
      expect(JSON.stringify(auditMock.log.mock.calls)).not.toContain(
        'NewTenant2026',
      );
    });

    it('拒绝弱密码和尚未激活的管理员', async () => {
      await expect(
        svc.resetAdminPassword('t-1', '12345678', '平台运营'),
      ).rejects.toThrow('10-128');

      repoMock.findOne.mockResolvedValue(
        tenant({ status: 'PENDING_ACTIVATION' }),
      );
      tenantAccountsMock.findOne.mockResolvedValue(null);
      await expect(
        svc.resetAdminPassword('t-1', 'NewTenant2026', '平台运营'),
      ).rejects.toThrow('尚未完成管理员激活');
    });
  });
});
