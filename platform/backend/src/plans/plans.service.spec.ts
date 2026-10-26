import { HttpException } from '@nestjs/common';
import { PlansService } from './plans.service';
import { Plan } from './plan.entity';

/** 依赖 mock：TypeORM Repository（repo/tenants）+ PlanPriceService + AuditService */
const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'plan-1', name: '标准版', price: 999, validityDays: 30,
  robotLimit: 5, userLimit: 200, kbLimit: 5, aiQuota: 3000,
  fileSizeLimitMb: 0, storageLimitMb: 512, channelLimit: 2, adminWindowLimit: 1,
  isActive: true, isFeatured: false,
  ...over,
} as Plan);

const repoMock = {
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
  create: jest.fn(),
};
const tenantsMock = {
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
};
const auditMock = { log: jest.fn((_params: unknown) => Promise.resolve({})) };

const qbMock = () => ({
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  getRawMany: jest.fn(),
});

describe('PlansService', () => {
  let svc: PlansService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new PlansService(repoMock as any, tenantsMock as any, {} as any, auditMock as any);
  });

  describe('list — tenantCount 聚合', () => {
    it('按 tenants.plan_id 分组计数（排除已删除租户）', async () => {
      repoMock.find.mockResolvedValue([plan({ id: 'p1', name: '标准版' }), plan({ id: 'p2', name: '旗舰版' })]);
      const qb = qbMock();
      qb.getRawMany.mockResolvedValue([{ planId: 'p1', cnt: '3' }]);
      tenantsMock.createQueryBuilder.mockReturnValue(qb);

      const list = await svc.list();
      expect(list[0].tenantCount).toBe(3);
      expect(list[1].tenantCount).toBe(0); // 无租户 → 0
      expect(qb.where).toHaveBeenCalledWith('t.status != :deleted', { deleted: 'DELETED' });
    });

    it('空租户表 → 全部为 0', async () => {
      repoMock.find.mockResolvedValue([plan()]);
      const qb = qbMock();
      qb.getRawMany.mockResolvedValue([]);
      tenantsMock.createQueryBuilder.mockReturnValue(qb);
      expect((await svc.list())[0].tenantCount).toBe(0);
    });
  });

  describe('remove — 删除校验', () => {
    it('有租户在用 → 42201 要求先迁移', async () => {
      repoMock.findOne.mockResolvedValue(plan({ id: 'p1' }));
      tenantsMock.count.mockResolvedValue(2);
      await expect(svc.remove('p1')).rejects.toThrow(HttpException);
      await expect(svc.remove('p1')).rejects.toThrow('有 2 个租户正在使用');
      expect(repoMock.delete).not.toHaveBeenCalled();
    });

    it('无租户在用 → 正常删除', async () => {
      repoMock.findOne.mockResolvedValue(plan({ id: 'p1' }));
      tenantsMock.count.mockResolvedValue(0);
      repoMock.delete.mockResolvedValue({ affected: 1 });
      await svc.remove('p1');
      expect(repoMock.delete).toHaveBeenCalledWith('p1');
    });
  });

  describe('update / setActive — 写平台审计', () => {
    it('字段变更 → 审计记录变更字段与在用租户影响面', async () => {
      repoMock.findOne.mockResolvedValue(plan({ id: 'p1', name: '标准版', price: 999 }));
      repoMock.save.mockImplementation(async (p: Plan) => p);
      tenantsMock.count.mockResolvedValue(1);

      await svc.update('p1', { price: 1999 });
      expect(auditMock.log).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 'platform',
        question: '[套餐] 修改套餐（标准版）',
        result: expect.stringContaining('price'),
      }));
      expect((auditMock.log.mock.calls[0][0] as { result: string }).result).toContain('在用租户 1 个');
    });

    it('无字段实际变更 → 不写审计', async () => {
      repoMock.findOne.mockResolvedValue(plan({ id: 'p1', price: 999 }));
      repoMock.save.mockImplementation(async (p: Plan) => p);
      await svc.update('p1', { price: 999 });
      expect(auditMock.log).not.toHaveBeenCalled();
    });

    it('setActive → 审计启/停', async () => {
      repoMock.findOne.mockResolvedValue(plan({ id: 'p1' }));
      repoMock.save.mockImplementation(async (p: Plan) => p);
      await svc.setActive('p1', false);
      expect(auditMock.log).toHaveBeenCalledWith(expect.objectContaining({ question: '[套餐] 停用套餐（标准版）' }));
    });
  });
});
