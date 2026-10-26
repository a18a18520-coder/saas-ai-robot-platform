import { ConfigService } from '@nestjs/config';
import { DifyClientService } from './dify-client.service';

describe('DifyClientService request timeout', () => {
  const platformSettings = {
    difyUrl: jest.fn(async () => 'http://dify.test'),
    adminApiKey: jest.fn(async () => undefined),
  };
  let service: DifyClientService;

  beforeEach(() => {
    jest.restoreAllMocks();
    service = new DifyClientService(
      new ConfigService({}),
      platformSettings as never,
      { decrypt: jest.fn((value?: string) => value) } as never,
      { findOne: jest.fn(async () => null) } as never,
    );
  });

  it('stops a stalled blocking chat call with a readable timeout error', async () => {
    const timeout = new Error('request timed out');
    timeout.name = 'TimeoutError';
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(timeout);

    await expect(service.runChat('app-key', '你好')).rejects.toThrow(
      'Dify 对话调用超时（120 秒）',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://dify.test/v1/chat-messages',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('rejects unassigned datasets before accessing console credentials', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(service.pipelineNodes('unassigned')).rejects.toThrow('未分配');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs the published console pipeline supported by Dify 1.9', async () => {
    service = new DifyClientService(new ConfigService({}), {
      ...platformSettings, adminApiKey: async () => 'admin-token',
    } as never, {} as never, { findOne: async () => ({ datasetId: 'dataset' }) } as never);
    const fetchMock = jest.spyOn(global, 'fetch');
    for (const body of [
      { pipeline_id: 'pipeline' },
      { graph: { nodes: [{ id: 'file-node', data: { type: 'datasource' } }] } },
      { id: 'file-id', name: 'test.txt', extension: 'txt', mime_type: 'text/plain', size: 10 },
      { documents: [{ id: 'document' }], batch: 'batch' },
    ]) fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await expect(service.runFilePipeline('dataset', { startNodeId: 'file-node' }, Buffer.from('测试。'), 'test.txt'))
      .resolves.toEqual({ documentId: 'document', batch: 'batch' });
    expect(fetchMock.mock.calls[3][0]).toBe('http://dify.test/console/api/rag/pipelines/pipeline/workflows/published/run');
    expect(JSON.parse(fetchMock.mock.calls[3][1]?.body as string)).toMatchObject({ is_preview: false, start_node_id: 'file-node', response_mode: 'blocking' });
  });
  it('executes a stateless workflow with server-side document IDs and no robot memory', async () => {
    jest.spyOn(service, 'ensureAdminToken').mockResolvedValue('console-token');
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ token: 'app-secret' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ workflow_run_id: 'run', data: { status: 'succeeded', outputs: { evidence: '[]' } } })));
    expect(await service.runEvidenceWorkflow('app','question',['doc'],'t:r')).toEqual({runId:'run',hits:[]});
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({inputs:{query:'question',allowed_documents:'["doc"]'},response_mode:'blocking',user:'t:r'});
  });

});
