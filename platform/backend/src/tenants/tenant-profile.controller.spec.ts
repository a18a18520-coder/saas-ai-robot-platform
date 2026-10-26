import { BadRequestException } from '@nestjs/common';
import { TenantProfileController } from './tenant-profile.controller';

describe('TenantProfileController security preferences', () => {
  const tenant = {
    id: 'tenant-1',
    config: {},
  } as any;
  const tenants = {
    findOne: jest.fn(async () => tenant),
    save: jest.fn(async (value) => value),
  };
  const plans = {};
  const audit = { log: jest.fn(async () => ({})) };
  const request = { ip: '203.0.113.8', socket: {} } as any;
  let controller: TenantProfileController;

  beforeEach(() => {
    jest.clearAllMocks();
    tenant.config = {};
    controller = new TenantProfileController(
      tenants as any,
      plans as any,
      audit as any,
    );
  });

  it('returns current tenant resource counts instead of sample quota usage', async () => {
    const count = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(4).mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    Object.assign(tenants, { manager: { getRepository: jest.fn(() => ({ count })) } });
    Object.assign(plans, { findOne: jest.fn(async () => null), find: jest.fn(async () => []) });
    const result = await controller.profile('tenant-1');
    expect(result.data?.resourceUsage).toEqual({ robots: 1, users: 4, knowledgeBases: 3, channels: 1 });
    expect(count).toHaveBeenCalledTimes(4);
    for (const call of count.mock.calls) expect(call).toEqual([{ where: { tenantId: 'tenant-1' } }]);
  });

  it('把安全选项规范化为后端可执行策略', async () => {
    const result = await controller.savePreferences(request, 'tenant-1', {
      preferences: {
        security: {
          passwordMinLength: 12,
          passwordComplexity: 'upper_lower_numbers_symbols',
          passwordExpiryDays: 180,
          lockMaxAttempts: 5,
          lockMinutes: 15,
          sessionTimeoutMinutes: 60,
          ipWhitelistEnabled: true,
          ipWhitelist: ['203.0.113.8'],
        },
      },
    });

    expect(result.data.security).toMatchObject({
      passwordMinLength: 12,
      sessionTimeoutMinutes: 60,
      ipWhitelistEnabled: true,
    });
    expect(tenants.save).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ question: '[设置] 更新安全策略' }),
    );
  });

  it('阻止管理员保存不包含当前地址的 IP 白名单', async () => {
    await expect(
      controller.savePreferences(request, 'tenant-1', {
        preferences: {
          security: {
            ipWhitelistEnabled: true,
            ipWhitelist: ['10.0.0.0/24'],
          },
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tenants.save).not.toHaveBeenCalled();
  });

  it('rejects notification delivery that is not implemented without saving', async () => {
    await expect(controller.savePreferences(request, 'tenant-1', { preferences: { notifyWays: ['邮件通知'] } })).rejects.toThrow('仅支持站内通知');
    await expect(controller.savePreferences(request, 'tenant-1', { preferences: { notifyTarget: '指定管理人员' } })).rejects.toThrow('暂不支持指定人员');
    expect(tenants.save).not.toHaveBeenCalled();
  });
  it('saves numeric thresholds and the supported notification destination', async () => {
    const preferences = { threshold1: '70', threshold2: '90', notifyWays: ['站内通知'], notifyTarget: '租户通知中心' };
    const result = await controller.savePreferences(request, 'tenant-1', { preferences });
    expect(result.data).toMatchObject(preferences);
  });
});
