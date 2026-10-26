import { isDirectFactQuestion, requestsDetail, requestsSources, validateAnswerStyle } from './answer-style';
import { retrievalKeywords } from './retrieval-keywords';
import { renderGroundedSummary } from './evidence-grounding';

it('distinguishes a name question from a request for background', () => {
  expect(isDirectFactQuestion('主角是谁')).toBe(true);
  expect(isDirectFactQuestion('游戏《神陨》中的主角是谁？')).toBe(true);
  expect(isDirectFactQuestion('主角是谁，请详细介绍经历')).toBe(false);
  expect(isDirectFactQuestion('第一章主要讲了什么？')).toBe(false);
});

it('defaults lists and summaries to concise answers, with detail and source opt-ins', () => {
  expect(requestsDetail('第一章有哪些人物呢')).toBe(false);
  expect(requestsDetail('第一章主要讲了什么')).toBe(false);
  expect(requestsDetail('请详细介绍第一章的人物')).toBe(true);
  expect(requestsSources('第一章有哪些人物呢')).toBe(false);
  expect(requestsSources('列出人物并给出原文出处')).toBe(true);
});

it('asks for correction if an identity answer adds an unrelated profession', () => {
  const raw = JSON.stringify({ sufficient: true, points: [{ text: '主角是某人，选择了某职业。' }] });
  expect(() => validateAnswerStyle(raw, '主角是谁')).toThrow('身份问题');
  expect(() => validateAnswerStyle(raw, '主角是谁，请介绍职业')).not.toThrow();
});

it('keeps identity recall when a game is the context, but not when the game is the target', () => {
  expect(retrievalKeywords('《神陨》中的主角是谁？').slice(0, 3)).toEqual(['名字', 'ID', '姓名']);
  expect(retrievalKeywords('主角进入的游戏叫什么')).not.toContain('姓名');
});

it('rejects a long factual answer for correction instead of silently dropping its claims', () => {
  const point = { text: '主角是某人', citations: [{ source: 1, quote: '某人' }] };
  const evidence = [{ content: '某人', datasetId: 'ds', documentId: 'doc' }] as any;
  expect(() => renderGroundedSummary(JSON.stringify({ sufficient: true, points: [point, point] }), evidence, { maxPoints: 1, maxChars: 160 })).toThrow('回答过长');
});
