/** Query vocabulary only. No answer facts or document-specific entities belong here. */
export function retrievalKeywords(question: string): string[] {
  const stop = /^(主角|主人公|谁|是|的|了|吗|呢|请|请问|我|你|他|它|这个|那个|什么|怎么|如何|哪里|哪个|多少|多久|是否|能否|可以|一下|介绍|解释|进入|叫|叫做|叫什|么)$/;
  // Intl's locale-aware word segmentation handles Chinese text without requiring spaces.
  const Segmenter = (Intl as any).Segmenter;
  const words: string[] = Segmenter
    ? [...new Segmenter('zh', { granularity: 'word' }).segment(question)].filter(s => s.isWordLike).map(s => s.segment)
    : question.split(/[\s，。？！、：]+/);
  const terms = words.flatMap((w, index) => {
    if (stop.test(w)) return [];
    if (w.length >= 2) return [w];
    const next = words[index + 1];
    return /^[\p{Script=Han}]$/u.test(w) && next?.length === 1 && !stop.test(next) ? [w + next] : [];
  });
  if (terms.includes('游戏')) terms.splice(terms.indexOf('游戏') + 1, 0, '网游');
  if (/(主角|主人公)(?:是?谁|的?(?:姓名|名字)(?:是|叫)?什么|叫什么)/.test(question)) terms.unshift('名字', 'ID', '姓名');
  return [...new Set(terms)].slice(0, 4);
}
import type { Evidence } from './answer.service';

export function fuseRecallLists(lists: Evidence[][], limit = 20): Evidence[] {
  const entries = new Map<string, { hit: Evidence; rank: number }>();
  for (const list of lists) {
    const seen = new Set<string>();
    list.forEach((hit, index) => {
      const key = `${hit.datasetId}:${hit.documentId}:${hit.segmentId}`;
      if (seen.has(key)) return;
      seen.add(key);
      const entry = entries.get(key) ?? { hit, rank: 0 };
      entry.rank += 1 / (60 + index + 1);
      entries.set(key, entry);
    });
  }
  return [...entries.values()].sort((a, b) => b.rank - a.rank).slice(0, limit).map(e => e.hit);
}
