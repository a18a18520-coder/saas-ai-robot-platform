import { ModelsService, ModelCallError, evidenceRequestOptions } from './models.service';

describe('model failover', () => {
  const primary = { id: 'p', isActive: true, tenantIds: ['a'], purpose: 'chat', contextWindow: 8192 };
  const backup = { ...primary, id: 'b', contextWindow: 4096 };
  const repo = { findOne: jest.fn(async ({ where }) => where.id === 'p' ? primary : backup) };
  const service = new ModelsService(repo as any, {} as any, { record: jest.fn() } as any);
  beforeEach(() => { jest.useFakeTimers(); jest.restoreAllMocks(); });
  afterEach(() => jest.useRealTimers());
  it('makes three retries before backup and rebuilds its context', async () => {
    const call = jest.spyOn(service as any, 'call').mockRejectedValueOnce(new ModelCallError(503)).mockRejectedValueOnce(new ModelCallError(503)).mockRejectedValueOnce(new ModelCallError(503)).mockRejectedValueOnce(new ModelCallError(503)).mockResolvedValue('ok');
    const build = jest.fn(async () => []);
    const result = service.generate('a', 'p', 'b', build);
    await jest.runAllTimersAsync();
    expect((await result).attempts).toHaveLength(5);
    expect(call).toHaveBeenCalledTimes(5);
    expect(build.mock.calls).toHaveLength(2);
  });
  it('rejects a model not granted to the tenant before any request', async () => {
    const call = jest.spyOn(service as any, 'call');
    await expect(service.generate('other', 'p', 'b', async () => [])).rejects.toThrow('未授权');
    expect(call).not.toHaveBeenCalled();
  });
  it('does not call backup on successful primary', async () => {
    const call = jest.spyOn(service as any, 'call').mockResolvedValue('ok');
    expect((await service.generate('a', 'p', 'b', async () => [])).modelId).toBe('p');
    expect(call).toHaveBeenCalledTimes(1);
  });
});


describe('structured evidence provider options', () => {
  it('uses the documented non-thinking mode only for opted-in official DeepSeek models', () => {
    expect(evidenceRequestOptions('https://api.deepseek.com','deepseek-flash',true)).toEqual({thinking:{type:'disabled'}});
    expect(evidenceRequestOptions('https://api.deepseek.com','deepseek-flash',false)).toEqual({});
    expect(evidenceRequestOptions('https://other-provider.test','deepseek-flash',true)).toEqual({});
    expect(evidenceRequestOptions('https://api.deepseek.com','another-model',true)).toEqual({});
  });
});
