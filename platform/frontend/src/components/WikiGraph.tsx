import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { AsyncButton, Feedback } from './Interaction';
type Chunk = { revision: number; chunk_index: number; status: string; error: string; edges: Array<{subject: string; relation: string; object: string; quote: string}> };
export default function WikiGraph({ pageId, revision }: {pageId: string; revision?: number}) {
  const [chunks,setChunks] = useState<Chunk[]>([]), [error,setError] = useState('');
  async function load() { try { setChunks(await api<Chunk[]>(`/api/v1/tenant/wiki/${pageId}/graph`)); setError(''); } catch(e) { setError((e as Error).message); } }
  useEffect(()=>{ void load(); const timer=setInterval(()=>void load(),10000); return ()=>clearInterval(timer); },[pageId,revision]);
  const current=chunks.filter(c=>c.revision===revision), edges=current.flatMap(c=>c.edges);
  return <section className="rag-panel" aria-label="Wiki 实体关系"><h3>实体关系与原文</h3><p className="small">发布后自动生成，按已发布版本参与授权检索。关系用于定位原文，不作为独立事实。</p>{error && <Feedback message={error}/>}
  {!revision ? <p>发布页面后生成关系。</p> : <p>版本 {revision} · 完成 {current.filter(c=>c.status==='completed').length}/{current.length} 段 · {edges.length} 条关系{!current.length ? ' · 等待生成' : ''}</p>}
  {current.some(c=>c.status==='failed') && <p>部分段落生成失败，请检查租户模型后重试。<AsyncButton className="btn btn-secondary" onClick={async()=>{try {await api(`/api/v1/tenant/wiki/${pageId}/graph/retry`,{method:'POST'});await load();}catch(e){setError((e as Error).message);}}}>重试失败段落</AsyncButton></p>}
  <AsyncButton className="btn btn-secondary" onClick={load}>刷新图谱状态</AsyncButton>
  <div style={{maxHeight:360,overflow:'auto',marginTop:12}}>{edges.map((e,i)=><details key={i} style={{padding:'8px 0',borderBottom:'1px solid var(--border-light)'}}><summary>{e.subject} → {e.relation} → {e.object}</summary><blockquote style={{whiteSpace:'pre-wrap'}}>{e.quote}</blockquote></details>)}</div>
  {!!current.length && current.every(c=>c.status==='completed') && !edges.length && <p>原文中未提取到可验证关系，普通知识检索仍然可用。</p>}</section>;
}
