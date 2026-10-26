import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { ToolExecutorService } from './tool-executor.service';

describe('declared tool HTTP execution', () => {
  let server: Server, url: string, received: any[], reply: unknown, status: number;
  let tool: any, repo: any, models: any, service: ToolExecutorService;
  const robot: any = { id: 'r', tenantId: 't', toolIdentifiers: ['order'], ragConfig: { toolsEnabled: true, primaryModelId: 'p' } };
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        received.push({ url: req.url, method: req.method, auth: req.headers.authorization, body });
        res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(reply));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/order`;
  });
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  beforeEach(() => {
    received = []; status = 200; reply = { status: 'shipped', privateNote: 'do not disclose' };
    tool = { readOnly: true, executionConfig: { mode: 'query' }, id: 'tool', identifier: 'order', name: '订单查询', allowedRoles: ['客服'], url, method: 'GET', authType: 'NONE', apiKey: 'old-secret', requestSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] }, responseWhitelist: ['status'] };
    repo = { find: jest.fn(async () => [tool]), increment: jest.fn(), update: jest.fn() };
    models = { generate: jest.fn(async () => ({ text: JSON.stringify({ tool: 'order', arguments: { orderId: 'A 1' } }) })) };
    service = new ToolExecutorService(repo, { decrypt: () => 'token' } as any, models);
  });
  const run = () => service.run(robot, '查订单 A 1', ['order'], ['客服']);
  it('executes GET once and exposes only declared result fields', async () => {
    const result = await run();
    expect(received).toEqual([{ url: '/order?orderId=A+1', method: 'GET', auth: undefined, body: '' }]);
    expect(JSON.parse(result[0].content)).toEqual({ status: 'shipped' });
    expect(repo.increment).toHaveBeenCalledWith({ id: 'tool' }, 'successCount', 1);
  });
  it('executes a read-only POST with injected credentials and declared JSON arguments', async () => {
    tool.method = 'POST'; tool.authType = 'API_KEY';
    await run();
    expect(received[0]).toMatchObject({ method: 'POST', auth: 'Bearer token', body: '{"orderId":"A 1"}' });
  });
  it.each([null, [], { privateNote: 'no usable fields' }])('rejects unusable results: %j', async data => {
    reply = data;
    await expect(run()).rejects.toThrow('工具返回');
    expect(repo.increment).not.toHaveBeenCalledWith({ id: 'tool' }, 'successCount', 1);
  });
  it('does not retry a failed external request', async () => {
    status = 500;
    await expect(run()).rejects.toThrow('工具服务失败');
    expect(received).toHaveLength(1);
    expect(repo.update).toHaveBeenCalledWith('tool', { lastCalledAt: expect.any(Date) });
  });
  it('rejects missing required arguments before sending HTTP', async () => {
    models.generate.mockResolvedValue({ text: '{"tool":"order","arguments":{}}' });
    await expect(run()).rejects.toThrow('缺少工具必要参数');
    expect(received).toHaveLength(0);
  });
});
