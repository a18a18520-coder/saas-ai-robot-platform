import { ConfigService } from '@nestjs/config';
import { DifyResourceService } from './dify-resource.service';
import { MASKED_SECRET, SecretsService } from '../secrets/secrets.service';

describe('DifyResourceService secret boundaries', () => {
  const secrets = new SecretsService(new ConfigService({ NODE_ENV: 'test', APP_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64') }));
  const client = { createDatasetKey: jest.fn(async () => 'ds-secret') };
  const repo = {
    findOne: jest.fn(), create: jest.fn((value) => value), save: jest.fn(async (value) => ({ id: 'row-1', createdAt: new Date(), status: 'ACTIVE', ...value })),
    find: jest.fn(), delete: jest.fn(),
  };
  const service = new DifyResourceService(client as never, new ConfigService({}), secrets, repo as never);

  beforeEach(() => jest.clearAllMocks());

  it('stores a generated ds-key encrypted and masks the assignment response', async () => {
    repo.findOne.mockResolvedValue(null);
    const result = await service.assignToTenant({ tenantId: 'tenant-a', resourceId: 'app-1', resourceType: 'app', datasetId: 'dataset-1' });
    const stored = repo.save.mock.calls[0][0];
    expect(stored.dsKey).toMatch(/^enc:v1:/);
    expect(secrets.decrypt(stored.dsKey)).toBe('ds-secret');
    expect(result.dsKey).toBe(MASKED_SECRET);
  });

  it('decrypts only for internal routing while public listings stay masked', async () => {
    const row = { id: 'row-1', tenantId: 'tenant-a', resourceId: 'app-1', status: 'ACTIVE', dsKey: secrets.encrypt('ds-secret') };
    repo.find.mockResolvedValue([row]);
    await expect(service.listByTenant('tenant-a')).resolves.toEqual([expect.objectContaining({ dsKey: MASKED_SECRET })]);
    await expect(service.listByTenant('tenant-a', true)).resolves.toEqual([expect.objectContaining({ dsKey: 'ds-secret' })]);
  });
});

describe('retrieval settings and original sentence context', () => {
  const whitelist = [{ datasetId: 'ds', dsKey: 'secret' }];
  const service = new DifyResourceService({ baseUrl: async () => 'http://dify' } as never, {} as never, {} as never, {} as never);
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  const response = (body: unknown) => ({ ok: true, json: async () => body });
  const segment = (position: number, extra = {}) => ({ id: `s${position}`, document_id: 'doc', position, content: `Sentence ${position}.`, enabled: true, status: 'completed', ...extra });
  const hit = (position: number) => ({ datasetId: 'ds', documentId: 'doc', documentName: 'Book', segmentId: `s${position}`, position, content: `Sentence ${position}.`, score: 0.6 });
  beforeEach(() => { fetchMock = jest.fn(); global.fetch = fetchMock; });
  afterEach(() => { global.fetch = originalFetch; });

  it('preserves published weights, reranker and threshold when no override is supplied', async () => {
    const config = { search_method: 'hybrid_search', reranking_enable: true, reranking_mode: 'weighted_score', weights: { vector_setting: { vector_weight: 0.7 } }, score_threshold_enabled: true, score_threshold: 0.65, top_k: 5 };
    fetchMock.mockResolvedValueOnce(response({ retrieval_model_dict: config })).mockResolvedValue(response({ records: [{ segment: segment(3), score: 0.8 }] }));
    await service.retrieveByWhitelist(whitelist, 'question', 10);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).retrieval_model).toEqual({ ...config, top_k: 10 });
  });

  it('allows an explicit zero threshold and fuses repeated segment IDs only once', async () => {
    fetchMock.mockResolvedValueOnce(response({ retrieval_model_dict: { score_threshold: 0.8 } }));
    fetchMock.mockImplementation(async (_url, init) => {
      const query = JSON.parse(init.body).query;
      return response({ records: (query === 'question' ? [segment(1), segment(2), segment(2)] : [segment(2), segment(3)]).map(s => ({ segment: s, score: 0.4 })) });
    });
    const results = await service.retrieveByWhitelist(whitelist, 'question', 10, { queries: ['question', 'synonym'], scoreThreshold: 0 });
    expect(results.map(h => h.segmentId)).toEqual(['s2', 's1', 's3']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).retrieval_model).toMatchObject({ score_threshold_enabled: true, score_threshold: 0 });
  });

  it('includes adjacent original sentences across page boundaries and records their real IDs', async () => {
    const segments = Array.from({ length: 110 }, (_, index) => segment(index + 1));
    fetchMock.mockImplementation(async url => { const page = Number(new URL(url).searchParams.get('page')); return response({ data: segments.slice((page - 1) * 100, page * 100), total: 110 }); });
    const [result] = await service.expandSentenceContext(whitelist, [hit(100)]);
    expect(result.contextSegmentIds).toEqual(Array.from({ length: 17 }, (_, index) => `s${92 + index}`));
    expect(result.content).toContain('Sentence 101.');
    expect(result.segmentId).toBe('s100');
  });

  it('locates the correct page when segment positions have gaps after deletions', async () => {
    const segments = Array.from({ length: 105 }, (_, index) => segment(index + 301));
    fetchMock.mockImplementation(async url => { const page = Number(new URL(url).searchParams.get('page')); return response({ data: segments.slice((page - 1) * 100, page * 100), total: 105 }); });
    const [result] = await service.expandSentenceContext(whitelist, [hit(400)]);
    expect(result.contextSegmentIds).toContain('s401');
    expect(result.contextSegmentIds).toContain('s399');
  });

  it('stops at disabled, incomplete and foreign-document segments', async () => {
    fetchMock.mockResolvedValue(response({ data: [segment(1), segment(2, { enabled: false }), segment(3), segment(4, { document_id: 'foreign' }), segment(5)], total: 5 }));
    const [result] = await service.expandSentenceContext(whitelist, [hit(3)]);
    expect(result.contextSegmentIds).toEqual(['s3']);
    expect(result.content).toBe('Sentence 3.');
  });

  it('does not fetch context from a dataset outside the whitelist', async () => {
    const foreign = { ...hit(3), datasetId: 'foreign' };
    await expect(service.expandSentenceContext(whitelist, [foreign])).resolves.toEqual([foreign]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when an indexed hit has been disabled or changed since retrieval', async () => {
    fetchMock.mockResolvedValue(response({ data: [segment(3, { enabled: false })], total: 1 }));
    await expect(service.expandSentenceContext(whitelist, [hit(3)])).rejects.toThrow('命中切片已变更');
  });
  it('does not return an indexed sentence that was deleted before context lookup', async () => {
    fetchMock.mockResolvedValue(response({ data: [segment(2), segment(4)], total: 2 }));
    await expect(service.expandSentenceContext(whitelist, [hit(3)])).rejects.toThrow('命中切片已变更');
  });
  it('literal recall keeps only enabled exact matches from the authorized document', async () => {
    fetchMock.mockResolvedValue(response({ data: [segment(1, { content: 'A name.' }), segment(2, { content: 'A name.', enabled: false }), segment(3, { content: 'A name.', document_id: 'foreign' }), segment(4, { content: 'Wildcard unrelated.' })] }));
    const result = await service.retrieveLiteralSentences(whitelist, [{ datasetId: 'ds', documentId: 'doc', documentName: 'Book' }, { datasetId: 'foreign', documentId: 'other', documentName: 'Denied' }], ['name']);
    expect(result.map(h => h.segmentId)).toEqual(['s1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('keyword=name');
  });
});


describe('workflow authorization boundary', () => {
  it('does not call a workflow assigned to a different tenant or robot', async () => {
    const client = { runEvidenceWorkflow: jest.fn() };
    const repo = { findOne: jest.fn(async () => null) };
    const service = new DifyResourceService(client as never, {} as never, {} as never, repo as never);
    await expect(service.retrieveByWorkflow('t', 'r', 'app', 'question', [{datasetId:'ds',documentId:'doc'}])).rejects.toThrow('无证据工作流授权');
    expect(client.runEvidenceWorkflow).not.toHaveBeenCalled();
    expect(repo.findOne).toHaveBeenCalledWith({where:{tenantId:'t',resourceId:'app',resourceType:'workflow',status:'ACTIVE',bindRobotId:'r'}});
  });
  it('revalidates returned dataset/document IDs instead of trusting the workflow', async () => {
    const good = {datasetId:'ds',documentId:'doc',segmentId:'seg',content:'Authorized fact'};
    const client = { runEvidenceWorkflow: jest.fn(async () => ({runId:'run',hits:[good,{...good,documentId:'secret'},{...good,datasetId:'foreign'}]})) };
    const service = new DifyResourceService(client as never, {} as never, {} as never, {findOne:async()=>({datasetId:'ds'})} as never);
    expect((await service.retrieveByWorkflow('t','r','app','question',[{datasetId:'ds',documentId:'doc'}])).hits).toEqual([good]);
  });
});

describe('platform robot workflow binding', () => {
  const robot = { id: 'r', tenantId: 't', ragConfig: { systemPrompt: 'keep' }, publishedConfig: { ragConfig: { systemPrompt: 'keep' } } };
  const manager = { findOne: jest.fn(), save: jest.fn(async (_type, value) => value), transaction: jest.fn() };
  const repo = { findOne: jest.fn(), create: (v: unknown) => v, manager };
  const service = new DifyResourceService({} as never, {} as never, { encrypt: () => undefined } as never, repo as never);
  beforeEach(() => { jest.clearAllMocks(); repo.findOne.mockResolvedValue(null); manager.findOne.mockResolvedValue(structuredClone(robot)); manager.transaction.mockImplementation(fn => fn(manager)); });
  it('writes the selected workflow into draft and published binding without replacing prompts', async () => {
    await service.assignToTenant({ tenantId: 't', resourceId: 'w', resourceType: 'workflow', datasetId: 'd', bindRobotId: 'r' });
    expect(manager.save.mock.calls[1][1]).toMatchObject({ workflowId: 'w', ragConfig: { systemPrompt: 'keep' }, publishedConfig: { workflowId: 'w', ragConfig: { systemPrompt: 'keep' } } });
  });
  it('rejects foreign robots before saving a resource', async () => {
    manager.findOne.mockResolvedValue(null);
    await expect(service.assignToTenant({ tenantId: 't', resourceId: 'w', resourceType: 'workflow', datasetId: 'd', bindRobotId: 'foreign' })).rejects.toThrow('不属于');
    expect(manager.save).not.toHaveBeenCalled();
  });
  it('requires a dataset for an Agent binding', async () => {
    await expect(service.assignToTenant({ tenantId: 't', resourceId: 'a', resourceType: 'app', bindRobotId: 'r' })).rejects.toThrow('知识库 ID');
    expect(manager.save).not.toHaveBeenCalled();
  });
});

describe('Agent evidence adapter',()=>{
  const originalFetch=global.fetch;
  afterEach(()=>{global.fetch=originalFetch;});
  it('replaces Agent content with the actual authorized indexed segment',async()=>{
    const resource={tenantId:'t',resourceId:'agent',resourceType:'app',status:'ACTIVE',bindRobotId:'r',datasetId:'ds'};
    const client={baseUrl:async()=> 'http://dify',runEvidenceAgent:jest.fn(async()=>({runId:'run',hits:[{datasetId:'ds',documentId:'doc',segmentId:'s',content:'fabricated'},{datasetId:'foreign',documentId:'doc',segmentId:'s'}]}))};
    const service=new DifyResourceService(client as never,{} as never,{} as never,{findOne:async()=>resource} as never);
    jest.spyOn(service,'listByTenant').mockResolvedValue([{...resource,dsKey:'key'} as never]);
    global.fetch=jest.fn(async()=>({ok:true,json:async()=>({data:{id:'s',position:1,content:'真实原文',enabled:true,status:'completed'}})})) as never;
    const result=await service.retrieveByAgent('t','r','agent','问题',[{datasetId:'ds',documentId:'doc'}]);
    expect(result.hits).toHaveLength(1);expect(result.hits[0].content).toBe('真实原文');expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
