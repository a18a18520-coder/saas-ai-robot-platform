import { FollowUpsService } from './follow-ups.service';
import { FollowUpsController } from './follow-ups.controller';

function setup() {
  let item: any = { id: 'followup', tenantId: 'tenant', robotId: 'robot', question: '问题', status: 'pending', resolution: {} };
  const manager = { findOne: jest.fn(async () => structuredClone(item)), save: jest.fn(async (_: any, row: any) => { item = structuredClone(row); return row; }) };
  const repo = { findOne: jest.fn(async () => structuredClone(item)), manager: { transaction: (work: any) => work(manager) } };
  const jobs = { findOne: jest.fn(async () => null as any) };
  const ingestion = { enqueue: jest.fn(async () => ({ id: 'job' })) };
  const service = new FollowUpsService(repo as any, {} as any, { find: async () => [{ datasetId: 'kb', name: '关联知识库', pipelineConfig: { startNodeId: 'start' } }] } as any, jobs as any, { findOne: async () => ({ publishedConfig: { kbPool: ['kb'] } }) } as any, ingestion as any, { log: jest.fn(async () => undefined) } as any);
  return { service, repo, manager, jobs, ingestion };
}
it('stores an answer without ingesting internal notes or calling the ingestion pipeline', async () => {
  const f = setup();
  const saved = await f.service.answer('tenant', 'followup', 'operator', { answer: '人工答案', note: '仅内部可见', saveToKnowledge: false });
  expect(saved.status).toBe('followed');
  expect(saved.resolution.answeredBy).toBe('operator');
  expect(f.ingestion.enqueue).not.toHaveBeenCalled();
});
it('ingests only question and answer into the selected tenant robot knowledge base', async () => {
  const f = setup();
  await f.service.answer('tenant', 'followup', 'operator', { answer: '答案', note: '内部备注', saveToKnowledge: true, datasetId: 'kb', secLevel: 2 });
  const args = (f.ingestion.enqueue.mock.calls as any)[0];
  expect(args.slice(0, 2)).toEqual(['tenant', 'kb']);
  expect(args[3].toString()).toContain('答案');
  expect(args[3].toString()).not.toContain('内部备注');
  expect(args[4]).toBe(2); expect(args[5]).toBe('followup');
  expect(args[7]).toBe(f.manager); // answer and queued job commit in the same transaction
});
it('uses the same source/version for retries, but new revisions when reverting an answer', async () => {
  const f = setup();
  for (const answer of ['A', 'A', 'B', 'A']) await f.service.answer('tenant', 'followup', 'op', { answer, saveToKnowledge: true, datasetId: 'kb' });
  const calls = f.ingestion.enqueue.mock.calls as any;
  expect(calls[0][6]).toBe(calls[1][6]);
  expect(calls[2][6]).not.toBe(calls[1][6]);
  expect(calls[3][6]).not.toBe(calls[0][6]);
  expect(calls.every((args: any[]) => args[5] === 'followup')).toBe(true);
});
it('rejects an unrelated or foreign knowledge base before storing an answer', async () => {
  const f = setup();
  await expect(f.service.answer('tenant', 'followup', 'op', { answer: 'A', saveToKnowledge: true, datasetId: 'foreign' })).rejects.toThrow('关联');
  expect(f.manager.save).not.toHaveBeenCalled();
});
it('does not lose the prior answer if the ingestion pipeline rejects submission', async () => {
  const f = setup(); f.ingestion.enqueue.mockRejectedValueOnce(new Error('流水线不可用'));
  await expect(f.service.answer('tenant', 'followup', 'op', { answer: 'A', saveToKnowledge: true, datasetId: 'kb' })).rejects.toThrow('流水线不可用');
  expect(f.manager.save).not.toHaveBeenCalled();
});
it('blocks changing content while the previous version has an uncertain submission', async () => {
  const f = setup();
  await f.service.answer('tenant', 'followup', 'op', { answer: 'A', saveToKnowledge: true, datasetId: 'kb' });
  f.jobs.findOne.mockResolvedValue({ status: 'uncertain', sourceVersion: (f.ingestion.enqueue.mock.calls as any)[0][6] });
  await expect(f.service.answer('tenant', 'followup', 'op', { answer: 'B', saveToKnowledge: true, datasetId: 'kb' })).rejects.toThrow('尚未完成');
  expect(f.ingestion.enqueue).toHaveBeenCalledTimes(1);
});
it('requires knowledge-management permission for ingestion even with follow-up access', () => {
  const service = { answer: jest.fn() };
  const controller = new FollowUpsController(service as any);
  expect(() => controller.answer('t', 'f', { auth: { sub: 'op', windows: ['follow-ups'] } } as any, { answer: 'A', saveToKnowledge: true, datasetId: 'kb' })).toThrow('知识库管理权限');
  expect(service.answer).not.toHaveBeenCalled();
});
