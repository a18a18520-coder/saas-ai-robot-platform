import { EvaluationsService, recommendations } from './evaluations.module';

function fixture() {
  const test = { id: 'case', robotId: 'r', expectedDocuments: ['doc'], question: 'Q', expectedAnswer: 'A', channel: 'web', channelUserId: 'u' };
  const stored: any[] = [];
  const runs = { create: (v: any) => ({ ...v, id: 'run' }), save: jest.fn(async v => { stored.push(structuredClone(v)); return v; }), update: jest.fn(async () => ({})), findOne: jest.fn() };
  const models = { tenantPolicy: jest.fn(async () => ({ primaryModelId: 'tenant-model' })), generate: jest.fn() };
  const robots = { findOne: jest.fn(async () => ({ id: 'r', tenantId: 't', status: 'PUBLISHED', ragConfig: { systemPrompt: 'draft' }, publishedConfig: { ragConfig: { systemPrompt: 'published' }, kbPool: ['published-kb'] } })), manager: { query: jest.fn() } };
  const router = { handleMessage: jest.fn(async (_: any, evaluation: any) => { evaluation.capture(['actual evidence']); return { processed: true, answer: 'A', citations: [{ documentId: 'doc' }] }; }) };
  const ragas = { evaluate: jest.fn(async () => ({ engine: 'ragas', version: '0.3.7', scores: { faithfulness: 1, factual_correctness: 1, context_precision: 1, context_recall: 1 }, errors: {} })) };
  const service = new EvaluationsService({ findOne: async () => test } as any, runs as any, robots as any, router as any, models as any, ragas as any);
  return { service, runs, robots, router, ragas, stored, models };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
it('runs real retrieved contexts through Ragas with the published prompt and platform tenant model', async () => {
  const f = fixture();
  await f.service.start('t', 'case'); await settle();
  expect(f.ragas.evaluate).toHaveBeenCalledWith('t', 'r', { primaryModelId: 'tenant-model', fallbackModelId: undefined }, { user_input: 'Q', response: 'A', reference: 'A', retrieved_contexts: ['actual evidence'] }, expect.any(Function));
  expect(f.stored.at(-1).snapshot.config).toEqual({ systemPrompt: 'published', primaryModelId: 'tenant-model' });
  expect(f.stored.at(-1).status).toBe('completed');
  expect(f.stored.at(-1).result.citationCoverage).toBe(1);
});
it('keeps missing metric scores partial instead of silently scoring zero or success', async () => {
  const f = fixture();
  f.ragas.evaluate.mockResolvedValueOnce({ engine: 'ragas', version: '0.3.7', scores: { faithfulness: null as any, factual_correctness: 1, context_precision: 1, context_recall: 1 }, errors: {} });
  await f.service.start('t', 'case'); await settle();
  expect(f.stored.at(-1).status).toBe('partial');
  expect(f.stored.at(-1).result.scores.faithfulness).toBeNull();
});
it('rejects cross-tenant baselines and does not launch a model call', async () => {
  const f = fixture(); f.runs.findOne.mockResolvedValue(null);
  await expect(f.service.start('t', 'case', 'foreign', 'new prompt')).rejects.toThrow('评测记录不存在');
  expect(f.runs.findOne).toHaveBeenCalledWith({ where: { tenantId: 't', id: 'foreign' } });
  expect(f.router.handleMessage).not.toHaveBeenCalled();
});
it('tests a candidate without saving it to the robot', async () => {
  const f = fixture(); f.runs.findOne.mockResolvedValue({ caseId: 'case', status: 'completed', result: { scores: { faithfulness: 0.5 } } });
  await f.service.start('t', 'case', 'base', 'new prompt'); await settle();
  expect(f.router.handleMessage.mock.calls[0][1].systemPrompt).toBe('new prompt');
  expect(f.robots.manager.query).not.toHaveBeenCalled();
  expect(f.stored.at(-1).result.delta.faithfulness).toBe(0.5);
});
it('will not overwrite a draft edited since evaluation', async () => {
  const f = fixture(); f.runs.findOne.mockResolvedValue({ status: 'completed', robotId: 'r', snapshot: { candidatePrompt: 'new', draftPrompt: 'old' } });
  f.robots.manager.query.mockResolvedValue([[], 0]);
  await expect(f.service.adopt('t', 'run')).rejects.toThrow('草稿已变化');
});
it('identifies retrieval problems without suggesting broader permissions', () => {
  const result = recommendations({ faithfulness: 1, factual_correctness: 1, context_precision: 0.3, context_recall: 0.2 });
  expect(result.join(' ')).toContain('切片完整性'); expect(result.join(' ')).toContain('不要直接扩大知识权限');
});
