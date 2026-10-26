import { AsyncButton } from './Interaction';
import { useMemo, useState } from 'react';

/** Keep heading boundaries in the source; navigation never rewrites the saved body. */
export default function WikiReader({ text }: { text: string }) {
  const sections = useMemo(() => {
    const headings = [...text.matchAll(/^#{1,3}\s+(.+)$/gm)];
    if (!headings.length) return [{ title: '全文', content: text }];
    const result = headings.map((heading, index) => ({ title: heading[1], content: text.slice(heading.index, headings[index + 1]?.index ?? text.length) }));
    const introduction = text.slice(0, headings[0].index);
    if (introduction.trim()) result.unshift({ title: '来源与说明', content: introduction });
    return result;
  }, [text]);
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, sections.length - 1);
  return <div className="wiki-reader">
    <nav className="wiki-reader-nav" aria-label="正文导航">
      <label htmlFor="wiki-section">章节导航</label>
      <select id="wiki-section" className="select" value={index} onChange={event => setSelected(Number(event.target.value))}>
        {sections.map((section, i) => <option key={i} value={i}>{section.title}</option>)}
      </select>
      <span className="small">{index + 1} / {sections.length}</span>
      <AsyncButton className="btn btn-secondary btn-sm" disabled={index === 0} onClick={() => setSelected(index - 1)}>上一节</AsyncButton>
      <AsyncButton className="btn btn-secondary btn-sm" disabled={index === sections.length - 1} onClick={() => setSelected(index + 1)}>下一节</AsyncButton>
    </nav>
    <article className="wiki-reader-body">{sections[index].content.split('\n').map((line, i) => /^#{1,3}\s/.test(line) ? <h3 key={i}>{line.replace(/^#{1,3}\s+/, '')}</h3> : <div key={i}>{line || '\u00a0'}</div>)}</article>
  </div>;
}
