import { Logger } from '@nestjs/common';
import { ModelUsageService, normalizeUsage } from './model-usage.service';
import { ModelsService } from './models.service';

describe('robot token accounting', () => {
  const context = { tenantId: 'tenant-a', robotId: 'robot-a', modelId: 'model-a', operation: 'answer' as const, attempt: 1, fallback: false };
  afterEach(() => jest.restoreAllMocks());
  it('does not count cached or reasoning details twice', () => {
    expect(normalizeUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 60 }, completion_tokens_details: { reasoning_tokens: 10 } }))
      .toEqual({ input: 100, output: 20, total: 120, incomplete: false });
    expect(normalizeUsage({ input_tokens: 0, output_tokens: 0 })).toEqual({ input: 0, output: 0, total: 0, incomplete: false });
  });
  it('preserves unknown usage and partial provider totals', () => {
    expect(normalizeUsage(undefined)).toEqual({ input: null, output: null, total: null, incomplete: true });
    expect(normalizeUsage({ total_tokens: 15 })).toEqual({ input: null, output: null, total: 15, incomplete: true });
    expect(normalizeUsage({ prompt_tokens: -1, completion_tokens: '12' }).total).toBeNull();
  });
  it('scopes all aggregates to the signed tenant and uses Shanghai months', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ id: 'robot-a' }]).mockResolvedValue([]);
    await new ModelUsageService({ query } as any).stats('tenant-a', 'robot-a');
    expect(query.mock.calls[0][0]).toContain('tenant_id=$2');
    for (const [sql, params] of query.mock.calls.slice(1)) {
      expect(sql).toContain('"tenantId"=$1 AND "robotId"=$2');
      expect(params).toEqual(['tenant-a', 'robot-a']);
    }
    expect(query.mock.calls[2][0]).toContain("AT TIME ZONE 'Asia/Shanghai'");
  });
  it('denies other tenant robots without reading usage', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await expect(new ModelUsageService({ query } as any).stats('tenant-b', 'robot-a')).rejects.toThrow('机器人不存在');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('does not fail a model call when persistence fails', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const query = jest.fn().mockRejectedValue(new Error('database down'));
    const service = new ModelUsageService({ query } as any);
    await expect(service.record(context, new Date(), true, { total_tokens: 5 })).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('records consumed tokens even when generated output is truncated', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 20 } }) } as any);
    const service = new ModelsService({} as any, {} as any, { record } as any);
    await expect((service as any).call({ contextWindow: 8192, maxOutputTokens: 1024, timeoutMs: 1000, baseUrl: 'https://model.test', apiKey: '' }, [], 1000, context)).rejects.toThrow();
    expect(record).toHaveBeenCalledWith(context, expect.any(Date), false, { prompt_tokens: 10, completion_tokens: 20 });
  });
  it('records timeout as unknown rather than zero', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('timeout'));
    const service = new ModelsService({} as any, {} as any, { record } as any);
    await expect((service as any).call({ contextWindow: 8192, maxOutputTokens: 1024, timeoutMs: 1000, baseUrl: 'https://model.test', apiKey: '' }, [], 1000, context)).rejects.toThrow('timeout');
    expect(record).toHaveBeenCalledWith(context, expect.any(Date), false, undefined);
  });
});
