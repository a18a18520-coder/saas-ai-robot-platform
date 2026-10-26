import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { ToolExecutorService } from './tool-executor.service';

describe('tool execution over local HTTP', () => {
  let server: Server, service: ToolExecutorService, tool: any, received: any[];
  let response: any, status: number;
  beforeEach(async () => {
    received = []; status = 200; response = { code: 0, result: '已受理', privateField: 'hidden' };
    server = createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk;
      received.push({ method: req.method, url: req.url, body, key: req.headers['idempotency-key'], identity: req.headers['x-user-id'] });
      res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(response));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    service = new ToolExecutorService({ increment: jest.fn(), update: jest.fn() } as any, {} as any, {} as any);
    tool = { id: 'test', name: '本地测试', isActive: true, authType: 'NONE', method: 'GET', url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/test`, requestSchema: { properties: { order: { type: 'string' } }, required: ['order'] }, responseWhitelist: ['code', 'result'], executionConfig: { mode: 'query', successField: 'code', successValue: 0 } };
  });
  afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  it('encodes query inputs and strips undeclared output', async () => {
    const result = await service.execute(tool, { order: 'A & B' });
    expect(new URL(received[0].url, tool.url).searchParams.get('order')).toBe('A & B');
    expect(JSON.parse(result[0].content)).toEqual({ code: 0, result: '已受理' });
  });
  it('blocks missing fields before any HTTP request', async () => {
    await expect(service.execute(tool, {})).rejects.toThrow('必要参数');
    expect(received).toHaveLength(0);
  });
  it('requires confirmation and sends submission data with its idempotency key', async () => {
    tool.method = 'POST'; tool.executionConfig.mode = 'submit';
    await expect(service.execute(tool, { order: 'A1' })).rejects.toThrow('确认');
    await service.execute(tool, { order: 'A1' }, 'confirmed-1');
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: 'POST', body: '{"order":"A1"}', key: 'confirmed-1' });
  });
  it('rejects business failure and invalid output without retrying', async () => {
    response.code = 1;
    await expect(service.execute(tool, { order: 'A1' })).rejects.toThrow('业务失败');
    response = { code: 0, result: 123 };
    tool.executionConfig.responseSchema = { type: 'object', properties: { result: { type: 'string' } }, required: ['result'] };
    await expect(service.execute(tool, { order: 'A1' })).rejects.toThrow();
    expect(received).toHaveLength(2);
  });
  it('does not retry HTTP failures', async () => {
    status = 503;
    await expect(service.execute(tool, { order: 'A1' })).rejects.toThrow('503');
    expect(received).toHaveLength(1);
  });
  it('sends the configured local identity but forbids it to remote hosts', async () => {
    service = new ToolExecutorService({ increment: jest.fn(), update: jest.fn() } as any, { decrypt: () => 'case-reader' } as any, {} as any);
    tool.authType = 'API_KEY'; tool.apiKey = 'encrypted'; tool.executionConfig.authHeader = 'X-User-Id';
    await service.execute(tool, { order: 'A1' });
    expect(received[0].identity).toBe('case-reader');
    tool.url = 'https://example.com/cases';
    await expect(service.execute(tool, { order: 'A1' })).rejects.toThrow('本机接口');
    expect(received).toHaveLength(1);
  });
});
