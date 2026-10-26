import { AuditLog } from './audit-log.entity';

export type AnswerCategory = 'hit' | 'insufficient' | 'failed' | 'denied' | 'tool' | 'other';
export function answerCategory(row: Pick<AuditLog, 'result'>): AnswerCategory {
  if (/失败|错误/.test(row.result)) return 'failed';
  if (/拒绝/.test(row.result)) return 'denied';
  if (/证据不足|未命中|转人工/.test(row.result)) return 'insufficient';
  if (/命中/.test(row.result)) return 'hit';
  if (/工具/.test(row.result)) return 'tool';
  return 'other';
}

// Legacy operation records use [module] prefixes. Known answer results take
// precedence so that a customer's question beginning with '[' still counts.
export function isConversationAudit(row: Pick<AuditLog, 'question' | 'result'>): boolean {
  return ['知识命中', '证据不足', '未命中转人工', '生成失败', '检索服务失败', '权限拒绝', '额度拒绝', '工具调用'].includes(row.result) || !row.question.startsWith('[');
}
