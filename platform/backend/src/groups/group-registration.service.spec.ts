import { GroupRegistrationService } from './group-registration.service';

describe('GroupRegistrationService', () => {
  const groups = { findOne: jest.fn(), create: jest.fn((value) => value), save: jest.fn(async (value) => ({ id: 'g-1', ...value })) };
  const audit = { log: jest.fn(async () => undefined) };
  const service = new GroupRegistrationService(groups as never, audit as never);

  beforeEach(() => jest.clearAllMocks());

  it('按租户、渠道和群 ID 幂等登记真实回调群', async () => {
    groups.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'g-1', tenantId: 't-1', channel: 'wecom', chatId: 'chat-1' });
    await service.register({ tenantId: 't-1', channel: 'wecom', chatId: 'chat-1', name: '研发群' });
    await service.register({ tenantId: 't-1', channel: 'wecom', chatId: 'chat-1' });
    expect(groups.save).toHaveBeenCalledTimes(1);
    expect(groups.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-1', channel: 'wecom', chatId: 'chat-1', status: 'PENDING' }));
    expect(audit.log).toHaveBeenCalledTimes(1);
  });
});
