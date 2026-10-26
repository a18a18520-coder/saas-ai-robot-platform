import { AiRouterService } from './ai-router.service';

describe('AiRouterService quota and tenant gates', () => {
  const robots = { findOne: jest.fn() };
  const groups = { findOne: jest.fn() };
  const conversations = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(async () => undefined),
  };
  const messages = { create: jest.fn(), save: jest.fn() };
  const groupMembers = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const identity = { resolve: jest.fn() };
  const permission = { compute: jest.fn() };
  const dify = { listByTenant: jest.fn(), retrieveByWhitelist: jest.fn() };
  const audit = { log: jest.fn(async () => undefined) };
  const followUps = { enqueue: jest.fn() };
  const contentFilter = { filter: jest.fn() };
  const quota = { consume: jest.fn() };
  const tenants = { findOne: jest.fn() };
  let service: AiRouterService;

  const message = {
    tenantId: 'tenant-a',
    channel: 'web',
    channelUserId: 'visitor-a',
    robotId: 'robot-a',
    isAtRobot: true,
    content: '查询订单',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AiRouterService(
      robots as any,
      groups as any,
      conversations as any,
      messages as any,
      groupMembers as any,
      identity as any,
      permission as any,
      dify as any,
      audit as any,
      followUps as any,
      contentFilter as any,
      quota as any,
      tenants as any,
      { applyTenantModels: jest.fn(async () => undefined) } as any,
      {} as any,
    );
    conversations.findOne.mockResolvedValue(null);
    conversations.create.mockImplementation((value) => value);
    conversations.save.mockImplementation(async (value) => ({ id: value.id ?? 'conversation-a', ...value }));
    messages.create.mockImplementation((value) => value);
    messages.save.mockImplementation(async (value) => ({ id: value.id ?? 'message-a', ...value }));
    groupMembers.findOne.mockResolvedValue(null);
    groupMembers.create.mockImplementation((value) => value);
    groupMembers.save.mockImplementation(async (value) => value);
  });

  it('租户停用时在任何业务写入前结束', async () => {
    tenants.findOne.mockResolvedValue(null);
    await expect(service.handleMessage(message)).resolves.toEqual({
      processed: false,
      blocked: true,
      reason: 'tenant_inactive',
    });
    expect(contentFilter.filter).not.toHaveBeenCalled();
    expect(identity.resolve).not.toHaveBeenCalled();
  });

  it('评测会话立即标记结束，不会被后续渠道消息复用', async () => {
    tenants.findOne.mockResolvedValue({ id: 'tenant-a', status: 'ACTIVE' });
    contentFilter.filter.mockResolvedValue({ action: 'ALLOWED', text: message.content });
    identity.resolve.mockResolvedValue({ user: { id: 'u', status: 'DISABLED' }, source: 'channel', confidence: '高' });
    await service.handleMessage(message, { capture: jest.fn() });
    expect(conversations.findOne).not.toHaveBeenCalled();
    expect(conversations.update).toHaveBeenCalledWith('conversation-a', expect.objectContaining({ endedAt: expect.any(Date), contextRef: expect.stringContaining('Ragas') }));
    expect(conversations.save).toHaveBeenLastCalledWith(expect.objectContaining({ endedAt: expect.any(Date) }));
  });

  it('额度已用尽时不调用 Dify，并写入拒绝审计', async () => {
    tenants.findOne.mockResolvedValue({ id: 'tenant-a', status: 'ACTIVE' });
    contentFilter.filter.mockResolvedValue({
      action: 'ALLOWED',
      text: message.content,
    });
    identity.resolve.mockResolvedValue({
      user: { id: 'user-a', status: 'ACTIVE' },
      source: 'phone_match',
      confidence: '高',
    });
    permission.compute.mockResolvedValue({
      roles: ['客服'],
      kbWhitelist: ['kb-a'],
    });
    robots.findOne.mockResolvedValue({
      id: 'robot-a',
      status: 'PUBLISHED',
      kbPool: ['kb-a'],
    });
    quota.consume.mockResolvedValue({
      allowed: false,
      used: 100,
      limit: 100,
      reason: 'quota_exceeded',
    });

    await expect(service.handleMessage(message)).resolves.toMatchObject({
      processed: true,
      blocked: true,
      reason: 'quota_exceeded',
    });
    expect(dify.listByTenant).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ result: '额度拒绝' }),
    );
    expect(messages.save).toHaveBeenCalledWith(expect.objectContaining({ role: 'user', content: '查询订单' }));
    expect(messages.save).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant', content: expect.stringContaining('额度已用尽') }));
  });

  it('待确认群的首条 @ 消息也会创建会话和用户消息', async () => {
    tenants.findOne.mockResolvedValue({ id: 'tenant-a', status: 'ACTIVE' });
    groups.findOne.mockResolvedValue({ id: 'group-a', status: 'PENDING', robotId: null });
    contentFilter.filter.mockResolvedValue({ action: 'ALLOWED', text: '首次咨询' });
    identity.resolve.mockResolvedValue({
      user: { id: 'user-a', status: 'ACTIVE' },
      source: 'channel_identity',
      confidence: '高',
    });

    await expect(service.handleMessage({
      tenantId: 'tenant-a', channel: 'dingtalk', channelUserId: 'staff-a', chatId: 'chat-a', isAtRobot: true, content: '首次咨询',
    })).resolves.toEqual({ processed: false, reason: 'group_not_bound', conversationId: 'conversation-a' });

    expect(conversations.create).toHaveBeenCalledWith({
      tenantId: 'tenant-a', robotId: 'pending', groupId: 'group-a', userId: 'user-a', channel: 'dingtalk',
    });
    expect(messages.save).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-a', role: 'user', content: '首次咨询',
    }));
    expect(permission.compute).not.toHaveBeenCalled();
    expect(quota.consume).not.toHaveBeenCalled();
  });
});

describe('conversation isolation', () => {
  const conversations = { findOne: jest.fn(), create: jest.fn(v => v), save: jest.fn(async v => ({ id: 'new', ...v })) };
  const messages = { create: jest.fn(v => v), save: jest.fn() };
  const service = new AiRouterService({} as any, {} as any, conversations as any, messages as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  beforeEach(() => jest.clearAllMocks());
  it('does not reuse an implicit web session', async () => {
    await (service as any).recordInboundMessage({ tenantId: 'a', robotId: 'r', userId: 'u', channel: 'web', content: 'hello' });
    expect(conversations.findOne).not.toHaveBeenCalled();
  });
  it('validates explicit session against tenant, robot, user and channel', async () => {
    conversations.findOne.mockResolvedValue(null);
    await expect((service as any).recordInboundMessage({ tenantId: 'a', robotId: 'r', userId: 'u', channel: 'web', conversationId: 'foreign', content: 'hello' })).rejects.toThrow('会话不存在');
    expect(conversations.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'a', robotId: 'r', userId: 'u', channel: 'web', id: 'foreign' }) }));
    expect(messages.save).not.toHaveBeenCalled();
  });
});

describe('sentence retrieval authorization and pipeline', () => {
  it('recovers a literal miss only inside authorized documents, then expands context before ranking', async () => {
    const robot = { id: 'r', tenantId: 't', status: 'PUBLISHED', kbPool: ['ds'], ragConfig: { topK: 5, wikiRootIds: ['root'] }, humanHandoff: { enabled: false } };
    const doc = { tenantId: 't', datasetId: 'ds', difyDocumentId: 'allowed', name: 'Book', secLevel: 1, isActive: true, syncStatus: 'completed' };
    const hit = { datasetId: 'ds', documentId: 'allowed', segmentId: 'sentence', content: 'An identity.', score: 0 };
    const files = { find: jest.fn(async () => [doc, { ...doc, difyDocumentId: 'secret', secLevel: 3 }, { ...doc, difyDocumentId: 'revoked', syncStatus: 'revoked' }, { ...doc, difyDocumentId: 'disabled', isActive: false }, { ...doc, difyDocumentId: 'other-wiki', sourceId: 'outside' }]), manager: { find: jest.fn(async () => [{ id: 'outside', status: 'published' }]) } };
    const dify = { listByTenant: jest.fn(async () => [{ datasetId: 'ds', dsKey: 'secret' }]), retrieveByWhitelist: jest.fn(async () => []), retrieveLiteralSentences: jest.fn(async () => [hit]), expandSentenceContext: jest.fn(async (_list, hits) => hits.map(h => ({ ...h, content: 'Name: Lin.\nAn identity.', contextSegmentIds: ['name', h.segmentId] }))) };
    const answers = { applyTenantModels: jest.fn(), rewrite: jest.fn(async (_r, _c, q) => q), expandQueries: jest.fn(async (_r, q) => [q]), rerank: jest.fn(async (_r, _q, hits) => hits), answer: jest.fn(async () => ({ text: 'Name: Lin. [1]', grounded: true, citations: [] })) };
    const records = { findOne: jest.fn(async () => null), create: jest.fn(v => v), save: jest.fn(async v => ({ id: 'c', ...v })) };
    const audit = { log: jest.fn(async () => undefined) };
    const router = new AiRouterService(
      { findOne: async () => robot } as any, {} as any, records as any, records as any, {} as any,
      { resolve: async () => ({ user: { id: 'u', status: 'ACTIVE', knowledgeClearance: 1 } }) } as any,
      { compute: async () => ({ roles: ['user'], kbWhitelist: ['ds'] }) } as any,
      dify as any, audit as any, {} as any, { filter: async text => ({ action: 'ALLOWED', text }) } as any,
      { consume: async () => ({ allowed: true }) } as any, { findOne: async () => ({ status: 'ACTIVE' }) } as any, answers as any, files as any,
    );
    const result = await router.handleMessage({ tenantId: 't', robotId: 'r', channel: 'web', channelUserId: 'u', isAtRobot: true, content: '主角是谁' });
    expect(result).toMatchObject({ processed: true, hits: 1 });
    expect(dify.retrieveLiteralSentences).toHaveBeenCalledWith(expect.any(Array), [{ datasetId: 'ds', documentId: 'allowed', documentName: 'Book' }], expect.any(Array));
    expect(answers.rerank.mock.calls[0][2][0].content).toContain('Name: Lin.');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ datasetHits: [expect.objectContaining({ segmentId: 'sentence', contextSegmentIds: ['name', 'sentence'] })] }));
  });
});
