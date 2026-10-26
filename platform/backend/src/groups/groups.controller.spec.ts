import { GroupsController } from './groups.controller';

describe('group binding tenant isolation', () => {
  let controller: GroupsController, repo: any, robots: any;
  beforeEach(() => {
    repo = { findOne: jest.fn(async () => ({ id: 'group', tenantId: 'tenant', chatId: 'chat', status: 'PENDING' })), save: jest.fn(async g => g) };
    robots = { findOne: jest.fn(async () => null) };
    controller = new GroupsController(repo, {} as any, { log: jest.fn(async () => {}) } as any, robots);
  });
  it('rejects robots outside the tenant without saving', async () => {
    await expect(controller.bind('group', 'tenant', { robotId: 'foreign' })).rejects.toThrow('不属于');
    expect(robots.findOne).toHaveBeenCalledWith({ where: { id: 'foreign', tenantId: 'tenant' } });
    expect(repo.save).not.toHaveBeenCalled();
  });
  it('rejects deleted robots and enabling unbound groups', async () => {
    robots.findOne.mockResolvedValue({ status: 'DELETED' });
    await expect(controller.bind('group', 'tenant', { robotId: 'deleted' })).rejects.toThrow('不存在');
    await expect(controller.setStatus('group', 'tenant', { status: 'BOUND' })).rejects.toThrow('先绑定');
    expect(repo.save).not.toHaveBeenCalled();
  });
  it('rejects invalid status and permits disabling without a robot', async () => {
    await expect(controller.setStatus('group', 'tenant', { status: 'FAKE' } as any)).rejects.toThrow('无效');
    expect((await controller.setStatus('group', 'tenant', { status: 'DISABLED' })).status).toBe('DISABLED');
  });
  it('binds a valid tenant robot', async () => {
    robots.findOne.mockResolvedValue({ status: 'ACTIVE' });
    expect((await controller.bind('group', 'tenant', { robotId: 'robot' }))?.status).toBe('BOUND');
  });
});
