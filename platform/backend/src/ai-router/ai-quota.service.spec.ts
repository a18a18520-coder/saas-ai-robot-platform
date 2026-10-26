import { AiQuotaService } from './ai-quota.service';

describe('AiQuotaService', () => {
  const tenant = {
    id: 'tenant-a',
    name: '测试租户',
    status: 'ACTIVE',
    planId: 'plan-a',
    aiQuotaUsed: 79,
    cycleStartAt: '2026-09-01',
    config: { threshold1: '80', threshold2: '90' },
  };
  const plan = { id: 'plan-a', aiQuota: 100, validityDays: 30 };
  const updateResult = { affected: 1, raw: [{ ai_quota_used: 80 }] };
  const builder: Record<string, jest.Mock> = {};
  for (const method of ['update', 'set', 'where', 'andWhere', 'returning'])
    builder[method] = jest.fn(() => builder);
  builder.execute = jest.fn(async () => updateResult);
  const tenants = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => builder),
  };
  const plans = { findOne: jest.fn() };
  const notifications = {
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  let service: AiQuotaService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-09-14T10:00:00').getTime());
    tenants.findOne.mockResolvedValue({ ...tenant });
    plans.findOne.mockResolvedValue({ ...plan });
    builder.execute.mockResolvedValue(updateResult);
    notifications.findOne.mockResolvedValue(null);
    service = new AiQuotaService(
      tenants as any,
      plans as any,
      notifications as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('原子预留一次用量并在阈值处只发一次通知', async () => {
    const result = await service.consume('tenant-a');
    expect(result).toMatchObject({
      allowed: true,
      used: 80,
      limit: 100,
      alertLevel: 'REMINDER',
    });
    expect(builder.andWhere).toHaveBeenCalledWith('"ai_quota_used" < :limit', {
      limit: 100,
    });
    expect(notifications.save).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a', type: 'quota' }),
    );
  });

  it('预警通知失败不回滚已预留用量或阻断 AI 请求', async () => {
    notifications.findOne.mockRejectedValueOnce(new Error('通知库不可用'));

    await expect(service.consume('tenant-a')).resolves.toMatchObject({
      allowed: true,
      used: 80,
      limit: 100,
    });
  });

  it('并发更新未命中时返回超限而不外呼', async () => {
    builder.execute.mockResolvedValue({ affected: 0, raw: [] });
    tenants.findOne
      .mockResolvedValueOnce({ ...tenant })
      .mockResolvedValueOnce({ ...tenant, aiQuotaUsed: 100 });
    const result = await service.consume('tenant-a');
    expect(result).toEqual({
      allowed: false,
      used: 100,
      limit: 100,
      reason: 'quota_exceeded',
    });
    expect(notifications.save).not.toHaveBeenCalled();
  });

  it('不限额套餐仍记录真实用量但不设上限', async () => {
    plans.findOne.mockResolvedValue({ ...plan, aiQuota: 0 });

    await expect(service.consume('tenant-a')).resolves.toMatchObject({
      allowed: true,
      used: 80,
      limit: 0,
    });
    expect(builder.andWhere).not.toHaveBeenCalledWith(
      '"ai_quota_used" < :limit',
      expect.anything(),
    );
    expect(notifications.save).not.toHaveBeenCalled();
  });

  it('扣减时租户被并发停用则返回停用而非误报超限', async () => {
    builder.execute.mockResolvedValue({ affected: 0, raw: [] });
    tenants.findOne
      .mockResolvedValueOnce({ ...tenant })
      .mockResolvedValueOnce({ ...tenant, status: 'DISABLED' });

    await expect(service.consume('tenant-a')).resolves.toMatchObject({
      allowed: false,
      reason: 'tenant_inactive',
    });
  });

  it('到期未续费不自动清零，也不扣减', async () => {
    tenants.findOne.mockResolvedValue({
      ...tenant,
      cycleStartAt: '2026-08-01',
      aiQuotaUsed: 100,
    });
    builder.execute
      .mockResolvedValueOnce({ affected: 1, raw: [] })
      .mockResolvedValueOnce({ affected: 1, raw: [{ ai_quota_used: 1 }] });
    const result = await service.consume('tenant-a');
    expect(result).toMatchObject({ allowed: false, reason: 'subscription_expired', used: 100 });
    expect(builder.execute).not.toHaveBeenCalled();
  });

  it('租户停用时不计量也不调用', async () => {
    tenants.findOne.mockResolvedValue({ ...tenant, status: 'DISABLED' });
    await expect(service.consume('tenant-a')).resolves.toMatchObject({
      allowed: false,
      reason: 'tenant_inactive',
    });
    expect(plans.findOne).not.toHaveBeenCalled();
    expect(builder.execute).not.toHaveBeenCalled();
  });
});
