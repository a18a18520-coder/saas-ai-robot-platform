import { ToolConversationService } from './tool-conversation.service';

describe('conversation tool form and submission lifecycle', () => {
  let service: ToolConversationService, repo: any, models: any, executor: any, tools: any, row: any, tool: any;
  const robot: any = { id: 'robot', tenantId: 'tenant', toolIdentifiers: ['ticket'], ragConfig: { toolsEnabled: true, primaryModelId: 'model', systemPrompt: '为客户创建售后工单' } };
  beforeEach(() => {
    row = { id: 'conversation', tenantId: 'tenant', robotId: 'robot', userId: 'customer', toolState: null };
    tool = { id: 'tool', identifier: 'ticket', description: '创建售后工单', name: '售后申请', url: 'https://example.test', allowedRoles: ['用户'], requestSchema: { type: 'object', properties: { order: { type: 'string', title: '订单号' }, issue: { type: 'string', title: '问题描述' } }, required: ['order', 'issue'] }, executionConfig: { mode: 'submit', successField: 'code', successValue: 0 } };
    tools = { find: jest.fn(async () => [tool]) };
    repo = { findOne: jest.fn(async ({ where }: any) => Object.entries(where).every(([k,v]) => row[k] === v) ? structuredClone(row) : null), query: jest.fn(async (_sql: string, params: any[]) => {
      if (row.endedAt || JSON.stringify(row.toolState) !== (params[4] ?? 'null')) return [];
      row.toolState = JSON.parse(params[0]); return [{ id: row.id }];
    }) };
    models = { generate: jest.fn() };
    executor = { execute: jest.fn(async () => [{ content: '{"code":0,"ticketId":"T-1"}' }]) };
    service = new ToolConversationService(tools, repo, models, executor);
  });
  const choose = (args: any) => ({ text: JSON.stringify({ tool: 'ticket', arguments: args, quotes: args }) });
  const handle = (text: string, overrides: any = {}, whitelist = ['ticket']) => service.handle(robot, { ...row, ...overrides }, text, whitelist, ['用户']);
  async function ready() { models.generate.mockResolvedValue(choose({ order: 'A1', issue: '损坏' })); return handle('A1 损坏'); }
  it('queries an authorized case number without inventing pagination parameters', async () => {
    tool.identifier = 'legal_case_query'; tool.readOnly = true;
    tool.executionConfig = { mode: 'query' };
    tool.requestSchema = { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'] };
    const configured = { ...robot, toolIdentifiers: ['legal_case_query'] };
    await service.handle(configured, row, '查询案件 CAS-2026-MOCK-005 的状态', ['legal_case_query'], ['用户']);
    expect(executor.execute).toHaveBeenCalledWith(tool, { keyword: 'CAS-2026-MOCK-005' }, undefined);
    expect(models.generate).not.toHaveBeenCalled();
  });
  it('does not bypass role whitelist for a case number', async () => {
    tool.identifier = 'legal_case_query'; tool.readOnly = true; tool.executionConfig = { mode: 'query' };
    expect(await service.handle({ ...robot, toolIdentifiers: ['legal_case_query'] }, row, 'CAS-2026-MOCK-005', [], ['用户'])).toBeNull();
    expect(executor.execute).not.toHaveBeenCalled();
  });
  it('never selects a disabled read-only tool', async () => {
    tool.readOnly = true; tool.executionConfig = {};
    expect(await handle('查询订单')).toBeNull();
    expect(models.generate).not.toHaveBeenCalled();
    expect(executor.execute).not.toHaveBeenCalled();
  });
  it('collects fields over multiple turns and submits only after exact confirmation', async () => {
    models.generate.mockResolvedValueOnce(choose({ order: 'A1' })).mockResolvedValueOnce(choose({ issue: '损坏' }));
    expect(await handle('A1')).toContain('问题描述');
    expect(await handle('损坏')).toContain('确认提交');
    expect(executor.execute).not.toHaveBeenCalled();
    const id = row.toolState.id;
    expect(await handle(`确认提交 ${id}`)).toContain('T-1');
    expect(executor.execute).toHaveBeenCalledWith(tool, { order: 'A1', issue: '损坏' }, id);
    expect(row.toolState.args).toEqual({});
  });
  it('sends once for concurrent confirmations and replays the stored result', async () => {
    await ready(); const confirm = `确认提交 ${row.toolState.id}`;
    await Promise.all([handle(confirm), handle(confirm)]);
    expect(await handle(confirm)).toContain('T-1');
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });
  it('renders a tool-owned template using actual returned data', async () => {
    tool.executionConfig.responseTemplate = '已受理，工单号：{{ticketId}}';
    await ready();
    expect(await handle(`确认提交 ${row.toolState.id}`)).toBe('已受理，工单号：T-1');
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });
  it('combines tool reply rules with the robot prompt without executing the API again', async () => {
    tool.executionConfig.responseFormat = '先给编号再说明状态';
    const answers = { answer: jest.fn(async (..._args: any[]) => ({ text: 'T-1 已受理', grounded: true })) };
    service = new ToolConversationService(tools, repo, models, executor, answers as any);
    await ready();
    expect(await handle(`确认提交 ${row.toolState.id}`)).toBe('T-1 已受理');
    expect(answers.answer.mock.calls[0][0].ragConfig.systemPrompt).toContain('先给编号再说明状态');
    expect(answers.answer.mock.calls[0][6]).toBe(true);
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });
  it('invalidates old confirmation after customer changes a field', async () => {
    await ready(); const old = row.toolState.id;
    models.generate.mockResolvedValue(choose({ order: 'A2' }));
    await handle('改成 A2');
    expect(await handle(`确认提交 ${old}`)).toContain('编号无效');
    expect(executor.execute).not.toHaveBeenCalled();
    await handle(`确认提交 ${row.toolState.id}`);
    expect(executor.execute).toHaveBeenCalledWith(tool, { order: 'A2', issue: '损坏' }, expect.any(String));
  });
  it('does not retry submissions with uncertain results, including after service restart', async () => {
    await ready(); const confirm = `确认提交 ${row.toolState.id}`;
    executor.execute.mockRejectedValue(new Error('timeout'));
    expect(await handle(confirm)).toEqual({ text: expect.stringContaining('结果尚未确认'), needsHandoff: true });
    service = new ToolConversationService(tools, repo, models, executor);
    await handle(confirm);
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });
  it('returns configured business rejection without claiming success', async () => {
    tool.executionConfig.failureMessage = '请核对订单'; await ready();
    executor.execute.mockRejectedValue(new Error('接口返回业务失败'));
    expect(await handle(`确认提交 ${row.toolState.id}`)).toEqual({ text: '请核对订单', needsHandoff: true });
  });
  it('cancels without sending', async () => {
    await ready(); await handle('取消'); expect(row.toolState.status).toBe('cancelled'); expect(executor.execute).not.toHaveBeenCalled();
  });
  it('rechecks authorization before confirmation', async () => {
    await ready(); expect(await handle(`确认提交 ${row.toolState.id}`, {}, [])).toContain('无权'); expect(executor.execute).not.toHaveBeenCalled();
  });
  it('rejects changed endpoint or expired confirmation', async () => {
    await ready(); tool.url = 'https://changed.test'; expect(await handle(`确认提交 ${row.toolState.id}`)).toContain('变更'); expect(executor.execute).not.toHaveBeenCalled();
  });
  it('does not read another conversation or user state', async () => {
    await ready(); expect(await handle('确认提交', { userId: 'other' })).toBeNull(); expect(await handle('确认提交', { id: 'other' })).toBeNull(); expect(executor.execute).not.toHaveBeenCalled();
  });
  it('expires unconfirmed forms without sending', async () => {
    await ready(); row.toolState.expires = 1;
    expect(await handle(`确认提交 ${row.toolState.id}`)).toContain('过期');
    expect(executor.execute).not.toHaveBeenCalled();
  });
  it('does not call the model or API if the robot disables tools', async () => {
    expect(await service.handle({ ...robot, ragConfig: { toolsEnabled: false } } as any, row, '提交', ['ticket'], ['用户'])).toBeNull();
    expect(models.generate).not.toHaveBeenCalled(); expect(executor.execute).not.toHaveBeenCalled();
  });
  it('rejects invented customer parameters', async () => {
    models.generate.mockResolvedValue(choose({ order: 'invented' })); expect(await handle('帮我办售后')).toContain('明确提供'); expect(row.toolState).toBeNull();
  });
  it('performs read-only queries after collecting required fields without a submission confirmation', async () => {
    tool.readOnly = true; tool.executionConfig.mode = 'query'; expect(await ready()).toContain('查询结果'); expect(executor.execute).toHaveBeenCalledWith(tool, { order: 'A1', issue: '损坏' }, undefined);
  });
});
