/** Shared boundary between Dify, human review and tool/person delivery. */
export type ReviewDecision = 'passed' | 'rejected' | 'needs_information' | 'human_review';
export interface RuleEvidence {
  id: string;
  datasetId: string;
  documentId: string;
  segmentId: string;
  version: string;
  content: string;
}
export interface ReviewFinding {
  ruleId: string;
  ruleQuote: string;
  contentQuote: string;
  explanation: string;
}
export interface ReviewResult {
  decision: ReviewDecision;
  summary: string;
  findings: ReviewFinding[];
}
export type ReviewException = 'missing_content' | 'missing_rules' | 'invalid_output' | 'unsupported_evidence' | 'execution_failed' | 'needs_information' | 'human_review';
export type ReviewOutcome = { state: 'completed'; result: ReviewResult } | { state: 'awaiting_human'; reason: ReviewException; result?: ReviewResult };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
const escalate = (reason: ReviewException): ReviewOutcome => ({ state: 'awaiting_human', reason });

/** Evidence must come from the platform's authorized retrieval snapshot, never from model-supplied metadata.
 * Valid citations prove traceability, not the semantic correctness of a model judgment. */
export function validateReviewResult(content: string, evidence: RuleEvidence[], output: unknown): ReviewOutcome {
  if (!content.trim()) return escalate('missing_content');
  if (!evidence.length) return escalate('missing_rules');
  const ids = new Set(evidence.map(rule => rule.id));
  if (ids.size !== evidence.length || evidence.some(rule => !rule.id || !rule.datasetId || !rule.documentId || !rule.segmentId || !rule.version || !rule.content.trim())) return escalate('unsupported_evidence');
  let parsed: unknown = output;
  if (typeof output === 'string') {
    if (output.length > 100_000) return escalate('invalid_output');
    try { parsed = JSON.parse(output); } catch { return escalate('invalid_output'); }
  }
  if (!isRecord(parsed) || !['passed', 'rejected', 'needs_information', 'human_review'].includes(String(parsed.decision)) || !text(parsed.summary, 4000) || !Array.isArray(parsed.findings) || parsed.findings.length > 100) return escalate('invalid_output');
  const findings: ReviewFinding[] = [];
  for (const finding of parsed.findings) {
    if (!isRecord(finding) || !text(finding.ruleId, 200) || !text(finding.ruleQuote, 10000) || !text(finding.contentQuote, 10000) || !text(finding.explanation, 4000)) return escalate('invalid_output');
    const rule = evidence.find(item => item.id === finding.ruleId);
    if (!rule || !rule.content.includes(finding.ruleQuote) || !content.includes(finding.contentQuote)) return escalate('unsupported_evidence');
    findings.push({ ruleId: finding.ruleId, ruleQuote: finding.ruleQuote, contentQuote: finding.contentQuote, explanation: finding.explanation });
  }
  if (parsed.decision === 'human_review' || parsed.decision === 'needs_information') return { state: 'awaiting_human', reason: parsed.decision, result: { decision: parsed.decision, summary: parsed.summary, findings } };
  // Both approval and rejection require traceable evidence. No matching rule cannot become approval.
  if (!findings.length) return escalate('unsupported_evidence');
  return { state: 'completed', result: { decision: parsed.decision as ReviewDecision, summary: parsed.summary, findings } };
}

export type DeliveryState = 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain';
export interface ReviewDelivery { person?: DeliveryState; tool?: DeliveryState }
/** A successful destination is never resent because the other destination failed. */
export function retryableReviewDestinations(delivery: ReviewDelivery): Array<'person' | 'tool'> {
  return (['person', 'tool'] as const).filter(key => delivery[key] === 'pending' || delivery[key] === 'failed');
}
