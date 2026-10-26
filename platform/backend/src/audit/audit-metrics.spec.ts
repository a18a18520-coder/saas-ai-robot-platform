import { answerCategory, isConversationAudit } from './audit-metrics';
import { AuditController } from './audit.controller';

describe('tenant audit metrics', () => {
  it('excludes operations but retains bracket-prefixed customer questions', () => {
    expect(isConversationAudit({ question: '[机器人] 发布', result: 'PUBLISHED' })).toBe(false);
    expect(isConversationAudit({ question: '[设置] 修改', result: '更新失败' })).toBe(false);
    expect(isConversationAudit({ question: '[小说]主角是谁', result: '知识命中' })).toBe(true);
  });
  it.each([
    ['知识命中', 'hit'], ['未命中转人工', 'insufficient'], ['证据不足', 'insufficient'],
    ['检索服务失败', 'failed'], ['生成失败', 'failed'], ['额度拒绝', 'denied'], ['工具调用', 'tool'],
  ])('classifies %s independently from actual handoff', (result, category) => {
    expect(answerCategory({ result })).toBe(category);
  });
  it('counts actual followups rather than assuming every insufficient answer was handed off', async () => {
    const createdAt = new Date();
    const followups = { find: jest.fn(async () => [{ createdAt }]) };
    const audits = {
      find: jest.fn(async () => [
        { question: '[机器人] 发布', result: 'PUBLISHED', createdAt },
        ...['知识命中', '证据不足', '证据不足', '生成失败', '额度拒绝', '工具调用'].map(result => ({ question: '问题', result, createdAt })),
      ]),
      manager: { getRepository: () => followups },
    };
    const result = await new AuditController({} as never, audits as never).stats('tenant-a', '7');
    expect(result.data?.dist).toEqual({ total: 6, hit: 1, handoff: 1, insufficient: 2, failed: 1, denied: 1, tool: 1, other: 0 });
    expect(result.data?.daily.reduce((n, d) => n + d.ai, 0)).toBe(6);
    expect(result.data?.daily.reduce((n, d) => n + d.handoff, 0)).toBe(1);
    expect(followups.find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a' }) }));
  });
});
