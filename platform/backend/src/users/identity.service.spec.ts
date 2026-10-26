import { IdentityService } from './identity.service';

describe('IdentityService enterprise directory match', () => {
  const users = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
  const identities = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
  const groupMembers = {};
  const audit = { log: jest.fn() };
  const dataSource = {};
  const service = new IdentityService(users as never, identities as never, groupMembers as never, audit as never, dataSource as never);

  beforeEach(() => jest.clearAllMocks());

  it('已由企业通讯录映射的渠道用户无需手机号也识别为员工', async () => {
    const mapping = { id: 'i-1', tenantId: 't-1', userId: 'u-1', channel: 'wecom', channelUserId: 'zhangsan', confidence: '高' };
    const employee = { id: 'u-1', tenantId: 't-1', name: '张三', identity: '员工', status: 'ACTIVE' };
    identities.findOne.mockResolvedValue(mapping);
    users.findOne.mockResolvedValue(employee);

    await expect(service.resolve({ tenantId: 't-1', channel: 'wecom', channelUserId: 'zhangsan' }))
      .resolves.toMatchObject({ user: employee, identity: mapping, source: 'employee_match', confidence: '高' });
    expect(users.save).not.toHaveBeenCalled();
  });

  it('钉钉首条消息创建带发送人昵称的游客身份', async () => {
    identities.findOne.mockResolvedValue(null);
    users.create.mockImplementation((value) => value);
    users.save.mockImplementation(async (value) => ({ id: 'u-2', status: 'ACTIVE', ...value }));
    identities.create.mockImplementation((value) => value);
    identities.save.mockImplementation(async (value) => ({ id: 'i-2', ...value }));

    const result = await service.resolve({
      tenantId: 't-1',
      channel: 'dingtalk',
      channelUserId: 'ding-user-1',
      displayName: '钉钉用户',
      content: '你好',
    });

    expect(users.create).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't-1', name: '钉钉用户', identity: '游客',
    }));
    expect(identities.create).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'dingtalk', channelUserId: 'ding-user-1', userId: 'u-2',
    }));
    expect(result.user.name).toBe('钉钉用户');
  });
});
