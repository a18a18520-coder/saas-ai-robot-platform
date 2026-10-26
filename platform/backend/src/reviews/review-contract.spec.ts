import { retryableReviewDestinations, RuleEvidence, validateReviewResult } from './review-contract';
const content = '申请金额为100元。';
const rules: RuleEvidence[] = [{ id: 'r1', datasetId: 'd1', documentId: 'doc1', segmentId: 's1', version: 'v1', content: '申请金额不得超过200元。' }];
const valid = () => ({ decision: 'passed', summary: '金额符合要求。', findings: [{ ruleId: 'r1', ruleQuote: '不得超过200元', contentQuote: '100元', explanation: '100未超过200。' }] });
it('accepts traceable structured and JSON output', () => {
  for (const output of [valid(), JSON.stringify(valid())]) expect(validateReviewResult(content, rules, output).state).toBe('completed');
});
it('escalates missing content and rules', () => {
  expect(validateReviewResult('', rules, valid())).toEqual({ state: 'awaiting_human', reason: 'missing_content' });
  expect(validateReviewResult(content, [], valid()).state).toBe('awaiting_human');
});
it.each([null, [], 'not json', { ...valid(), decision: 'approved' }, { ...valid(), findings: [] }, { ...valid(), summary: '' }])('fails closed for malformed output %p', output => {
  expect(validateReviewResult(content, rules, output).state).toBe('awaiting_human');
});
it.each([{ ruleId: 'another-tenant' }, { ruleQuote: '金额不限' }, { contentQuote: '1000元' }])('rejects fabricated evidence %p', patch => {
  const output = valid(); Object.assign(output.findings[0], patch);
  expect(validateReviewResult(content, rules, output)).toEqual({ state: 'awaiting_human', reason: 'unsupported_evidence' });
});
it('rejects unversioned and ambiguous snapshots', () => {
  expect(validateReviewResult(content, [{ ...rules[0], version: '' }], valid()).state).toBe('awaiting_human');
  expect(validateReviewResult(content, [...rules, ...rules], valid()).state).toBe('awaiting_human');
});
it.each(['human_review', 'needs_information'])('retains the explanation for %s', decision => {
  const output = { ...valid(), decision, findings: [] };
  expect(validateReviewResult(content, rules, output)).toEqual({ state: 'awaiting_human', reason: decision, result: output });
});
it('never retries an already delivered or uncertain destination', () => {
  expect(retryableReviewDestinations({ person: 'sent', tool: 'failed' })).toEqual(['tool']);
  expect(retryableReviewDestinations({ person: 'uncertain', tool: 'sending' })).toEqual([]);
});
