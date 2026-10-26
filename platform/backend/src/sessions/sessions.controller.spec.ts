import { SessionsController } from './sessions.controller';

describe('tenant session pagination', () => {
  const conversations = { findAndCount: jest.fn() };
  const messages = { count: jest.fn(async () => 2) };
  const controller = new SessionsController(conversations as never, messages as never);
  beforeEach(() => { jest.clearAllMocks(); conversations.findAndCount.mockResolvedValue([[{ id: 'session-51', robotId: 'robot-a' }], 51]); });
  it('returns older sessions with tenant and group scope and a stable tie breaker', async () => {
    const result = await controller.list('tenant-a', 'group-a', '2', '50');
    expect(result).toEqual({ items: [{ id: 'session-51', robotId: 'robot-a', messageCount: 2 }], total: 51, page: 2, pageSize: 50 });
    expect(conversations.findAndCount).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', groupId: 'group-a' }, order: { updatedAt: 'DESC', id: 'DESC' }, take: 50, skip: 50 });
  });
  it('keeps the legacy array response when page is omitted', async () => {
    expect(Array.isArray(await controller.list('tenant-a'))).toBe(true);
  });
  it.each([['0', '50'], ['1.5', '50'], ['1', '101'], ['NaN', '50']])('rejects invalid pagination %s / %s', async (page, size) => {
    await expect(controller.list('tenant-a', undefined, page, size)).rejects.toThrow('分页参数无效');
    expect(conversations.findAndCount).not.toHaveBeenCalled();
  });
});
