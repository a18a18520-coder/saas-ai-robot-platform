export type GraphEdge = { subject: string; relation: string; object: string; quote: string };
export function graphChunks(text: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += 5000) chunks.push(text.slice(offset, offset + 5500));
  return chunks;
}
export function parseGraph(text: string, source: string): GraphEdge[] {
  const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  if (!Array.isArray(parsed.edges)) throw new Error('图谱结果格式无效');
  const seen = new Set<string>();
  return parsed.edges.filter((e: GraphEdge) => {
    if (![e.subject, e.relation, e.object, e.quote].every(v => typeof v === 'string' && v.trim())) return false;
    if (e.subject.length > 100 || e.object.length > 100 || e.relation.length > 80 || e.quote.length > 1000) return false;
    if (!source.includes(e.quote) || !e.quote.includes(e.subject) || !e.quote.includes(e.object)) return false;
    const key = JSON.stringify(e); if (seen.has(key)) return false; seen.add(key); return true;
  }).slice(0, 50);
}
/** Two hops over already authorized edges. Relations guide recall, never replace source evidence. */
export function walkGraph<T extends GraphEdge>(edges: T[], query: string): T[] {
  let names = new Set(edges.flatMap(e => [e.subject, e.object]).filter(name => query.includes(name)));
  const selected = new Set<T>();
  for (let hop = 0; hop < 2; hop++) {
    const next = new Set<string>();
    for (const edge of edges) if (names.has(edge.subject) || names.has(edge.object)) {
      selected.add(edge); next.add(edge.subject); next.add(edge.object);
      if (selected.size >= 30) return [...selected];
    }
    names = next;
  }
  return [...selected];
}
