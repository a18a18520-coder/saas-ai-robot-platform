import { AiRouterService } from './ai-router.service';

describe('published collection routing', () => {
  const input = { tenantId: 't', channel: 'wechat', chatId: 'chat', channelUserId: 'u', sourceMessageId: 'm', isAtRobot: false, content: '需求' };
  const build = (robot: any, groupStatus = 'BOUND', tenant: any = { status: 'ACTIVE' }) => {
    const collection = { ingest: jest.fn(async () => ({ processed: true, collectionStatus: 'collected' })) };
    const quota = { consume: jest.fn() };
    const filter = { filter: jest.fn() };
    const service = new AiRouterService(
      { findOne: jest.fn(async () => robot) } as any,
      { findOne: jest.fn(async () => ({ id: 'g', chatId: 'chat', tenantId: 't', robotId: 'r', status: groupStatus })) } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      filter as any, quota as any, { findOne: jest.fn(async () => tenant) } as any,
      {} as any, {} as any, undefined, undefined, collection as any,
    );
    return { service, collection, quota, filter };
  };
  it('routes an ordinary group message to collection without entering RAG', async () => {
    const { service, collection, filter } = build({ id: 'r', tenantId: 't', status: 'PUBLISHED', publishedConfig: { ragConfig: { mode: 'collector' } } });
    expect(await service.handleMessage(input)).toMatchObject({ collectionStatus: 'collected', answer: undefined });
    expect(collection.ingest).toHaveBeenCalledTimes(1); expect(filter.filter).not.toHaveBeenCalled();
  });
  it('does not activate unpublished draft changes', async () => {
    const { service, collection } = build({ status: 'PUBLISHED', ragConfig: { mode: 'collector' }, publishedConfig: { ragConfig: { mode: 'qa' } } });
    expect(await service.handleMessage(input)).toMatchObject({ reason: 'not_at_robot' });
    expect(collection.ingest).not.toHaveBeenCalled();
  });
  it.each(['PENDING', 'DISABLED'])('blocks collection for %s groups', async status => {
    const { service, collection } = build({ status: 'PUBLISHED', ragConfig: { mode: 'collector' } }, status);
    expect(await service.handleMessage(input)).toMatchObject({ reason: 'group_not_bound' });
    expect(collection.ingest).not.toHaveBeenCalled();
  });
  it('blocks disabled robots, inactive tenants and mismatched robot overrides', async () => {
    const disabled = build({ status: 'DISABLED', ragConfig: { mode: 'collector' } });
    expect(await disabled.service.handleMessage(input)).toMatchObject({ reason: 'robot_not_published' });
    const inactive = build({ status: 'PUBLISHED', ragConfig: { mode: 'collector' } }, 'BOUND', null);
    expect(await inactive.service.handleMessage(input)).toMatchObject({ reason: 'tenant_inactive' });
    const bound = build({ status: 'PUBLISHED', ragConfig: { mode: 'collector' } });
    expect(await bound.service.handleMessage({ ...input, robotId: 'other' })).toMatchObject({ reason: 'robot_group_mismatch' });
    for (const fixture of [disabled, inactive, bound]) expect(fixture.collection.ingest).not.toHaveBeenCalled();
  });
  it('does not collect or consume quota for normal QA robots without a mention', async () => {
    const { service, collection, quota } = build({ status: 'PUBLISHED', ragConfig: {} });
    expect(await service.handleMessage(input)).toEqual({ processed: false, reason: 'not_at_robot' });
    expect(collection.ingest).not.toHaveBeenCalled(); expect(quota.consume).not.toHaveBeenCalled();
  });
});
