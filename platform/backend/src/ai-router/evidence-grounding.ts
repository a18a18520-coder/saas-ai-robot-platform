import type { Evidence } from './answer.service';

export const INSUFFICIENT_EVIDENCE = '当前检索到的原文不足以确认。请补充文档名称、章节或具体对象。';

/** Strict mode renders only verbatim extracts; model-generated prose is never returned. */
export function renderGroundedExtracts(raw: string, evidence: Evidence[]) {
  let data: { sufficient?: boolean; extracts?: Array<{ source: number; quote: string }> };
  try { data = JSON.parse(raw); } catch { throw new Error('原文回答格式无效'); }
  if (data?.sufficient === false) return { text: INSUFFICIENT_EVIDENCE, refs: [] as number[], extracts: [] as Array<{ source: number; quote: string }>, grounded: false };
  if (data?.sufficient !== true || !Array.isArray(data.extracts) || !data.extracts.length || data.extracts.length > 5) throw new Error('原文证据缺失');
  const lines = data.extracts.map(item => {
    if (!item || !Number.isInteger(item.source) || typeof item.quote !== 'string' || !item.quote.trim()) throw new Error('原文引用无效');
    const source = evidence[item.source - 1];
    if (!source || !source.content.includes(item.quote)) throw new Error('回答引文与切片不一致');
    return `「${item.quote}」[${item.source}]`;
  });
  return { text: '原文依据：\n' + lines.join('\n\n'), refs: [...new Set(data.extracts.map(item => item.source))], extracts: data.extracts, grounded: true };
}


/** Paraphrases require real quotes; a separate model checks semantic support before delivery. */
export function renderGroundedSummary(raw: string, evidence: Evidence[], limits: { maxPoints?: number; maxChars?: number } = {}) {
  const data = JSON.parse(raw);
  if (data?.sufficient === false) return { text: INSUFFICIENT_EVIDENCE, refs: [] as number[], extracts: [] as Array<{ source: number; quote: string }>, grounded: false };
  if (data?.sufficient !== true || !Array.isArray(data.points) || !data.points.length || data.points.length > 8) throw new Error('归纳回答格式无效');
  if (data.points.length > (limits.maxPoints ?? 8) || data.points.reduce((n: number, p: { text?: string }) => n + (p?.text?.length ?? 0), 0) > (limits.maxChars ?? Infinity)) throw new Error(`回答过长：最多${limits.maxPoints ?? 8}个短要点、${limits.maxChars ?? 800}字，只回答所问内容，不展开无关经历或证明过程`);
  const extracts: Array<{ source: number; quote: string }> = [];
  const lines = data.points.map((point: { text: string; citations: Array<{ source: number; quote: string }> }) => {
    if (typeof point.text !== 'string' || !point.text.trim() || /\[\d+\]/.test(point.text) || !Array.isArray(point.citations) || !point.citations.length) throw new Error('归纳回答缺少引用');
    for (const c of point.citations) {
      const source = evidence[c.source - 1];
      if (!Number.isInteger(c.source) || typeof c.quote !== 'string' || !c.quote.trim() || !source) throw new Error('回答引文与切片不一致');
      if (!source.content.includes(c.quote)) {
        const unwrapped = c.quote.replace(/^[\s“”「」『』"'。！？.!?]+|[\s“”「」『』"'。！？.!?]+$/g, '');
        if (unwrapped.length >= 6 && source.content.includes(unwrapped)) c.quote = unwrapped;
      }
      if (!source.content.includes(c.quote)) {
        // The model sometimes shifts a quote to an adjacent chapter block. Correct only
        // an exact, unique match in the same authorized document; never fuzzy-match text.
        const matches = evidence.map((h,i) => ({h,i})).filter(({h}) => h.datasetId === source.datasetId && h.documentId === source.documentId && h.content.includes(c.quote));
        if (matches.length !== 1) throw new Error('回答引文与切片不一致');
        c.source = matches[0].i + 1;
      }
      extracts.push(c);
    }
    return point.text.trim() + [...new Set(point.citations.map(c => c.source))].map(n => `[${n}]`).join('');
  });
  return { text: lines.join('\n\n'), refs: [...new Set(extracts.map(e => e.source))], extracts, grounded: true, normalized: JSON.stringify(data) };
}
