import { DirectorySyncService } from './directory-sync.service';
import { hashPhone } from './user.constants';

describe('DirectorySyncService', () => {
  const channels = { find: jest.fn(), findOne: jest.fn() };
  const users = { findOne: jest.fn(), create: jest.fn((value) => value), save: jest.fn(async (value) => ({ id: value.id ?? 'u-1', ...value })) };
  const identities = { findOne: jest.fn(), create: jest.fn((value) => value), save: jest.fn(async (value) => ({ id: value.id ?? 'i-1', ...value })) };
  const audit = { log: jest.fn(async () => undefined) };
  const secrets = { decryptRecord: (value: Record<string, string>) => ({ ...value }) };
  const service = new DirectorySyncService(channels as never, users as never, identities as never, audit as never, secrets as never);
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    channels.findOne.mockResolvedValue({ id: 'c-1', tenantId: 't-1', type: 'wecom', status: 'connected', config: { corp_id: 'corp', secret: 'secret' } });
    channels.find.mockResolvedValue([]);
    identities.findOne.mockResolvedValue(null);
    users.findOne.mockResolvedValue(null);
  });
  afterAll(() => { global.fetch = originalFetch; });

  it('从企微通讯录创建员工并建立高可信渠道身份', async () => {
    const replies = [
      { errcode: 0, access_token: 'token' },
      { errcode: 0, department: [{ id: 1, name: '研发部' }] },
      { errcode: 0, userlist: [{ userid: 'zhangsan', name: '张三', mobile: '13800138000', department: [1] }] },
    ];
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => replies.shift() })) as never;

    const result = await service.sync('t-1', 'c-1');

    expect(result).toMatchObject({ channel: 'wecom', fetched: 1, created: 1, updated: 0 });
    expect(users.save).toHaveBeenCalledWith(expect.objectContaining({ name: '张三', identity: '员工', department: '研发部', phoneHash: hashPhone('13800138000'), phoneMasked: '138****8000' }));
    expect(identities.create).toHaveBeenCalledWith(expect.objectContaining({ channel: 'wecom', channelUserId: 'zhangsan', confidence: '高' }));
  });

  it('默认同步会跳过缺少凭据的历史渠道', async () => {
    channels.find.mockResolvedValue([
      { id: 'broken', tenantId: 't-1', type: 'dingtalk', status: 'connected', config: {} },
      { id: 'valid', tenantId: 't-1', type: 'dingtalk', status: 'connected', config: { app_key: 'key', app_secret: 'secret' } },
    ]);
    const replies = [
      { accessToken: 'token' },
      { errcode: 0, result: [] },
      { errcode: 0, result: { list: [], has_more: false } },
    ];
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => replies.shift() })) as never;

    const result = await service.sync('t-1');

    expect(result).toMatchObject({ channelId: 'valid', channel: 'dingtalk', fetched: 0 });
  });
});
