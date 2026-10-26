import { ConfigService } from '@nestjs/config';
import { PlatformToolsService } from './platform-tools.service';
import { MASKED_SECRET, SecretsService } from '../secrets/secrets.service';

describe('PlatformToolsService credential storage', () => {
  const secrets = new SecretsService(new ConfigService({ NODE_ENV: 'test', APP_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64') }));
  const repo = {
    manager: { transaction: async (fn: any): Promise<any> => fn({ getRepository: () => repo }) },
    find: jest.fn(), findOne: jest.fn(), create: jest.fn((value) => value),
    save: jest.fn(async (value) => value), update: jest.fn(), delete: jest.fn(),
  };
  const service = new PlatformToolsService(repo as never, secrets);

  beforeEach(() => jest.clearAllMocks());

  it('does not invoke a disabled read-only tool through the test endpoint', async () => {
    const executor = { execute: jest.fn() };
    const tested = new PlatformToolsService(repo as never, secrets, executor as any);
    repo.findOne.mockResolvedValue({ id: 'tool-1', tenantId: 'tenant-a', readOnly: true, executionConfig: {} });
    await expect(tested.test('tool-1', {}, 'tenant-a')).rejects.toThrow('配置工具调用方式');
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('preserves omitted output settings during partial configuration updates', async () => {
    repo.findOne.mockResolvedValue({ id: 'tool-1', responseWhitelist: ['data'], executionConfig: { responseTemplate: '{{item.name}}', responseListPath: 'data.records' } });
    await service.update('tool-1', { executionConfig: { responseFormat: '简洁回答' } });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ executionConfig: { responseTemplate: '{{item.name}}', responseListPath: 'data.records', responseFormat: '简洁回答' } }));
  });
  it('migrates credentials without saving stale tool configuration', async () => {
    repo.findOne.mockResolvedValue({ id: 'tool-1', apiKey: 'plain' });
    await service.findOne('tool-1');
    expect(repo.update).toHaveBeenCalledWith({ id: 'tool-1', apiKey: 'plain' }, { apiKey: expect.stringMatching(/^enc:v1:/) });
    expect(repo.save).not.toHaveBeenCalled();
  });
  it('changes activation without overwriting a concurrently edited configuration', async () => {
    repo.findOne.mockResolvedValue({ id: 'tool-1', tenantId: 'tenant-a', executionConfig: { responseTemplate: 'new' } });
    await service.setActive('tool-1', false, 'tenant-a');
    expect(repo.update).toHaveBeenCalledWith({ id: 'tool-1', tenantId: 'tenant-a' }, { isActive: false });
    expect(repo.save).not.toHaveBeenCalled();
  });
  it('rejects a stale editor and preserves the latest configuration', async () => {
    repo.findOne.mockResolvedValue({ id: 'tool-1', name: 'old' });
    const snapshot = await service.findOne('tool-1');
    repo.findOne.mockResolvedValue({ id: 'tool-1', name: 'updated elsewhere' });
    await expect(service.update('tool-1', { name: 'stale overwrite', configRevision: snapshot.configRevision })).rejects.toThrow('其他操作更新');
    expect(repo.save).not.toHaveBeenCalled();
  });
  it('allows a current revision and ignores usage counter changes', async () => {
    repo.findOne.mockResolvedValue({ id: 'tool-1', name: 'old', callCount: 1 });
    const snapshot = await service.findOne('tool-1');
    repo.findOne.mockResolvedValue({ id: 'tool-1', name: 'old', callCount: 2 });
    await service.update('tool-1', { name: 'new', configRevision: snapshot.configRevision });
    expect(repo.save).toHaveBeenCalled();
  });
  it('stores new credentials encrypted and returns a mask', async () => {
    const result = await service.createForTenant({ tenantId: 'tenant-a', name: 'lookup', identifier: 'lookup', url: 'https://example.com', apiKey: 'plain' });
    expect(repo.save.mock.calls[0][0].apiKey).toMatch(/^enc:v1:/);
    expect(result.apiKey).toBe(MASKED_SECRET);
  });

  it('does not overwrite a stored credential when editing a masked response', async () => {
    const encrypted = secrets.encrypt('existing')!;
    repo.findOne.mockResolvedValue({ id: 'tool-1', name: 'old', apiKey: encrypted });
    await service.update('tool-1', { name: 'new', apiKey: MASKED_SECRET });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'new', apiKey: encrypted }));
  });

  it('scopes tenant-side detail and update lookups by tenant id', async () => {
    repo.findOne.mockResolvedValue({ id: 'tool-1', tenantId: 'tenant-a', apiKey: undefined });
    await service.findOne('tool-1', 'tenant-a');
    expect(repo.findOne).toHaveBeenLastCalledWith({ where: { id: 'tool-1', tenantId: 'tenant-a' } });
    await service.update('tool-1', { name: 'updated' }, 'tenant-a');
    expect(repo.findOne).toHaveBeenLastCalledWith({ where: { id: 'tool-1', tenantId: 'tenant-a' }, lock: { mode: 'pessimistic_write' } });
  });
  it('requires a business success declaration for submissions', async () => {
    await expect(service.createForTenant({ name: 'ticket', description: '创建工单', method: 'POST', url: 'https://example.com', responseWhitelist: ['code'], executionConfig: { mode: 'submit' } })).rejects.toThrow('业务成功字段');
    expect(repo.save).not.toHaveBeenCalled();
  });
  it('stores an explicitly declared submission without marking it read-only', async () => {
    const result = await service.createForTenant({ name: 'ticket', description: '创建工单', method: 'POST', url: 'https://example.com', readOnly: false, responseWhitelist: ['code'], requestSchema: { type: 'object', properties: { issue: { type: 'string' } }, required: ['issue'] }, executionConfig: { mode: 'submit', successField: 'code', successValue: 0 } });
    expect(result.readOnly).toBe(false);
    expect(result.executionConfig?.successValue).toBe(0);
  });
});
