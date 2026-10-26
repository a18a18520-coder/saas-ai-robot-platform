import { ToolExecutorService } from './tool-executor.service';

describe('robot tool authorization', () => {
  let repo: any, models: any, service: ToolExecutorService;
  const robot: any = { id: 'r', tenantId: 't', toolIdentifiers: ['allowed'], ragConfig: { toolsEnabled: true, primaryModelId: 'p' } };
  beforeEach(() => {
    repo = { find: jest.fn(async () => [{ identifier: 'allowed', allowedRoles: ['管理员'], requestSchema: {}, executionConfig: { mode: 'query' } }]) };
    models = { generate: jest.fn(async () => ({ text: '{"tool":"unapproved"}' })) };
    service = new ToolExecutorService(repo, {} as any, models);
  });
  it('does not even select tools when disabled', async () => {
    expect(await service.run({ ...robot, ragConfig: { toolsEnabled: false } }, 'call tool', ['allowed'], ['管理员'])).toEqual([]);
    expect(repo.find).not.toHaveBeenCalled();
    expect(models.generate).not.toHaveBeenCalled();
  });
  it('requires both robot binding and user whitelist', async () => {
    expect(await service.run(robot, 'call tool', ['other'], ['管理员'])).toEqual([]);
    expect(repo.find).not.toHaveBeenCalled();
  });
  it('requires the configured role', async () => {
    expect(await service.run(robot, 'call tool', ['allowed'], ['游客'])).toEqual([]);
    expect(models.generate).not.toHaveBeenCalled();
  });
  it('does not select tools with automatic invocation disabled', async () => {
    repo.find.mockResolvedValue([{ identifier: 'allowed', allowedRoles: ['管理员'], readOnly: true, executionConfig: {} }]);
    expect(await service.run(robot, '查询', ['allowed'], ['管理员'])).toEqual([]);
    expect(models.generate).not.toHaveBeenCalled();
  });
  it('rejects a model choice outside the authorized set', async () => {
    await expect(service.run(robot, 'call tool', ['allowed'], ['管理员'])).rejects.toThrow('未授权工具');
  });
  it('uses this robot business prompt when choosing from authorized API declarations', async () => {
    models.generate.mockImplementation(async (_tenant: any, _primary: any, _fallback: any, build: any) => {
      const messages = await build({});
      expect(messages[1].content).toContain('仅为客户查询售后工单进度');
      expect(messages[1].content).toContain('不得编造客户信息或缺失参数');
      expect(messages[0].content).toContain('allowed');
      return { text: '{"tool":null}' };
    });
    expect(await service.run({ ...robot, ragConfig: { ...robot.ragConfig, systemPrompt: '仅为客户查询售后工单进度' } }, '查询进度', ['allowed'], ['管理员'])).toEqual([]);
  });
});
