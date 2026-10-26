import { In, Repository } from 'typeorm';
import { KnowledgeFile } from '../knowledge/knowledge-file.entity';
import { WikiPage, WikiVersion } from '../wiki/wiki.entity';
import type { Evidence } from './answer.service';

function numberOf(text: string): number {
  if (/^\d+$/.test(text)) return Number(text);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0, digit = 0;
  for (const char of text) {
    if (char === '十' || char === '百' || char === '千') { total += (digit || 1) * ({ 十: 10, 百: 100, 千: 1000 }[char]); digit = 0; }
    else digit = digits[char] ?? 0;
  }
  return total + digit;
}
export function requestedChapter(query: string): number | undefined {
  const matches = [...query.matchAll(/第\s*([0-9零〇一二两三四五六七八九十百千]+)\s*章/g)];
  const numbers = [...new Set(matches.map(m => numberOf(m[1])))];
  // Multi-chapter comparisons require a separate retrieval strategy.
  return numbers.length === 1 ? numbers[0] : undefined;
}
export function chapterText(content: string, chapter: number): string | undefined {
  const headings = [...content.matchAll(/^(?:#{1,6}\s*)?第\s*([0-9零〇一二两三四五六七八九十百千]+)\s*章[^\n]*$/gm)];
  const index = headings.findIndex(h => numberOf(h[1]) === chapter);
  if (index < 0) return undefined;
  return content.slice(headings[index].index, headings[index + 1]?.index ?? content.length).trim();
}

function chapterChunks(content: string, maxChars = 1100): string[] {
  const paragraphs = content.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current) { chunks.push(current); current = ''; }
      let remaining = paragraph;
      while (remaining.length > maxChars) {
        // Prefer a sentence boundary so every returned quote remains readable.
        const boundary = Math.max(remaining.lastIndexOf('。', maxChars), remaining.lastIndexOf('！', maxChars), remaining.lastIndexOf('？', maxChars), remaining.lastIndexOf('」', maxChars));
        const cut = boundary > Math.floor(maxChars * 0.55) ? boundary + 1 : maxChars;
        chunks.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut).trim();
      }
      current = remaining;
      continue;
    }
    if (!current) { current = paragraph; continue; }
    if (current.length + paragraph.length + 2 <= maxChars) current += `\n\n${paragraph}`;
    else { chunks.push(current); current = paragraph; }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Read the indexed published revision, never the editable Wiki draft or another tenant's pages. */
export async function retrieveWikiChapter(repo: Repository<KnowledgeFile>, tenantId: string, datasetIds: string[], clearance: number, roots: string[] | undefined, query: string): Promise<Evidence[] | null> {
  const chapter = requestedChapter(query);
  if (chapter === undefined) return null;
  if (!datasetIds.length) return [];
  const files = await repo.find({ where: { tenantId, datasetId: In(datasetIds), isActive: true } });
  const pages = await repo.manager.find(WikiPage, { where: { tenantId } });
  const allowedRoot = (page: WikiPage) => {
    if (!roots?.length) return true;
    let cursor: WikiPage | undefined = page;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      if (roots.includes(cursor.id)) return true;
      seen.add(cursor.id); cursor = pages.find(p => p.id === cursor!.parentId);
    }
    return false;
  };
  const evidence: Evidence[] = [];
  for (const file of files) {
    if (file.secLevel > clearance || file.syncStatus !== 'completed' || !file.difyDocumentId) continue;
    const page = pages.find(p => p.id === file.sourceId && p.datasetId === file.datasetId);
    if (!page || page.status === 'archived' || page.secLevel > clearance || !page.publishedRevision || String(page.publishedRevision) !== file.sourceVersion || !allowedRoot(page)) continue;
    const version = await repo.manager.findOne(WikiVersion, { where: { tenantId, pageId: page.id, revision: page.publishedRevision } });
    if (!version) continue;
    const content = chapterText(version.content, chapter);
    if (!content) continue;
    chapterChunks(content).forEach((chunk, index) => evidence.push({ datasetId: file.datasetId, documentId: file.difyDocumentId!, segmentId: `${page.id}:chapter:${chapter}:${index + 1}`, documentName: `${version.title} · 第${chapter}章（原文片段 ${index + 1}）`, sourceId: page.id, sourceVersion: file.sourceVersion, content: chunk, score: 1 }));
  }
  // Do not silently mix the same chapter from multiple books. An explicit title disambiguates.
  if (new Set(evidence.map(hit => hit.sourceId ?? hit.documentId)).size > 1) {
    return evidence.filter(hit => query.includes(hit.documentName.split(' · 第')[0]));
  }
  return evidence;
}
