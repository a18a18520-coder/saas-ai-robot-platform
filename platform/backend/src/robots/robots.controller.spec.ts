import { RobotsController } from './robots.controller';

describe('RobotsController tenant boundary', () => {
  const repo = { find: jest.fn(), findOne: jest.fn(), save: jest.fn(async (value) => value), create: jest.fn((value) => value), delete: jest.fn() };
  const groups = { count: jest.fn(), update: jest.fn() };
  const audit = { log: jest.fn(async () => undefined) };
  const controller = new RobotsController(repo as never, groups as never, audit as never, {} as never);

  beforeEach(() => jest.clearAllMocks());

  it('loads robot details by id and authenticated tenant', async () => {
    repo.findOne.mockResolvedValue(null);
    await controller.detail('robot-1', 'tenant-a');
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'robot-1', tenantId: 'tenant-a' } });
  });

  it('does not allow an edit payload to change ownership or lifecycle status', async () => {
    repo.findOne.mockResolvedValue({ id: 'robot-1', tenantId: 'tenant-a', name: 'old', status: 'DRAFT' });
    const result = await controller.update('robot-1', 'tenant-a', { name: 'new', tenantId: 'tenant-b', status: 'PUBLISHED' });
    expect(result).toMatchObject({ name: 'new', tenantId: 'tenant-a', status: 'DRAFT' });
  });
  it('rejects tenant model changes even when submitted directly to the API', async () => {
    repo.findOne.mockResolvedValue({ id: 'r', tenantId: 't', ragConfig: { primaryModelId: 'platform' } });
    await expect(controller.update('r', 't', { ragConfig: { primaryModelId: 'other' } })).rejects.toThrow('平台统一配置');
    expect(repo.save).not.toHaveBeenCalled();
  });
  it('preserves models when the tenant edits the prompt', async () => {
    repo.findOne.mockResolvedValue({ id: 'r', tenantId: 't', ragConfig: { primaryModelId: 'platform' } });
    const result = await controller.update('r', 't', { ragConfig: { systemPrompt: 'New prompt' } });
    expect(result?.ragConfig).toMatchObject({ primaryModelId: 'platform', systemPrompt: 'New prompt' });
  });
  it('does not accept model assignment on creation', async () => {
    await expect(controller.create({ tenantId: 't', name: 'r', ragConfig: { primaryModelId: 'other' } })).rejects.toThrow('平台统一配置');
    expect(repo.save).not.toHaveBeenCalled();
  });
  it('blocks direct tenant workflow reassignment and creation', async () => {
    repo.findOne.mockResolvedValue({ id: 'r', tenantId: 't', workflowId: 'approved' });
    await expect(controller.update('r', 't', { workflowId: 'foreign' })).rejects.toThrow('由平台配置');
    await expect(controller.create({ tenantId: 't', difyAppId: 'foreign' })).rejects.toThrow('由平台配置');
    expect(repo.save).not.toHaveBeenCalled();
  });
  it('restoring a tenant version preserves the current platform binding', async () => {
    repo.findOne.mockResolvedValue({ id: 'r', tenantId: 't', workflowId: 'current', configHistory: [{version: 1, config: {workflowId: 'old', name: 'restored'}}] });
    const result = await controller.restoreConfig('r', 't', {version: 1});
    expect(result).toMatchObject({workflowId: 'current', name: 'restored'});
  });

});
