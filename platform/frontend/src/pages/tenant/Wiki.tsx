import { useFeedback, Feedback, AsyncButton, confirmAction, ModalFrame, Modal, LoadState, notify } from '../../components/Interaction';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { useSearchParams } from 'react-router-dom';
import WikiGraph from '../../components/WikiGraph';
import WikiReader from '../../components/WikiReader';
type Page = { id?: string; parentId?: string; title: string; content: string; kind: string; status: string; datasetId: string; secLevel: number; revision: number; publishedRevision?: number };
type Version = { revision: number; title: string; content: string; createdAt: string };
const blank: Page = { title: '', content: '', kind: 'page', status: 'draft', datasetId: '', secLevel: 1, revision: 0 };
function Preview({ text }: { text: string }) {
  return <article style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.8 }}>{text.split('\n').map((line, i) => line.startsWith('# ') ? <h2 key={i}>{line.slice(2)}</h2> : line.startsWith('## ') ? <h3 key={i}>{line.slice(3)}</h3> : <div key={i}>{line || '\u00a0'}</div>)}</article>;
}
export default function Wiki({ initialPageId, onClose }: { initialPageId?: string; onClose?: () => void } = {}) {
  const [editorOpen, setEditorOpen] = useState(false), [historyOpen, setHistoryOpen] = useState(false), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const baseline = useRef(JSON.stringify(blank));
  const initialized = useRef(false);
  const [pages, setPages] = useState<Page[]>([]), [page, setPage] = useState<Page>({ ...blank });
  const [pendingPage, setPendingPage] = useState<Page>();
  const [kbs, setKbs] = useState<Array<{ datasetId: string; name: string }>>([]), [versions, setVersions] = useState<Version[]>([]);
  const [compare, setCompare] = useState<Version>(), [preview, setPreview] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useFeedback();
  const dirty = JSON.stringify(page) !== baseline.current;
  function selectPage(next: Page, force = false) {
    if (!force && dirty) { setPendingPage(next); return; }
    setEditorOpen(true); baseline.current = JSON.stringify(next); setPage(next); setVersions([]); setCompare(undefined); setPreview(false); setMessage('');
    if (!initialPageId) setSearchParams(old => { const nextSearch = new URLSearchParams(old); if (next.id) nextSearch.set('page', next.id); else nextSearch.delete('page'); return nextSearch; }, { replace: true });
  }
  useEffect(() => { const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, [dirty]);
  async function load() { setLoadError(''); try { const result = await api<Page[]>('/api/v1/tenant/wiki'); setPages(result); if (!initialized.current) { initialized.current = true; const selected = result.find(p => p.id === (initialPageId ?? searchParams.get('page'))); if (selected) selectPage(selected, true); else if (initialPageId) throw new Error('Wiki 页面不存在或无权访问'); } } catch (cause) { setLoadError((cause as Error).message); } finally { setLoading(false); } }
  useEffect(() => { load().catch(e => setMessage(e.message)); api<Array<{ datasetId: string; name: string }>>('/api/v1/tenant/knowledge-base').then(setKbs).catch(e => setMessage(e.message)); }, []);
  async function action(work: () => Promise<void>) { setBusy(true); setMessage(''); try { await work(); await load(); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } }
  async function save() { const saved = await api<Page>('/api/v1/tenant/wiki' + (page.id ? `/${page.id}` : ''), { method: page.id ? 'PATCH' : 'POST', body: JSON.stringify(page) }); baseline.current = JSON.stringify(saved); setPage(saved); if (!initialPageId) setSearchParams(old => { const next = new URLSearchParams(old); next.set('page', saved.id!); return next; }, { replace: true }); notify('草稿已保存'); return saved; }
  function closeEditor() { setEditorOpen(false); if (onClose) onClose(); else setSearchParams(old => { const next = new URLSearchParams(old); next.delete('page'); return next; }, { replace: true }); }
  function tree(parentId = '', depth = 0, visited = new Set<string>()): React.ReactNode {
    return pages.filter(p => (p.parentId ?? '') === parentId && p.status !== 'archived').map(p => {
      if (!p.id || visited.has(p.id)) return null;
      const next = new Set(visited).add(p.id);
      return <div key={p.id}><AsyncButton className="btn btn-secondary" disabled={busy} style={{ display: 'block', textAlign: 'left', marginBottom: 6, marginLeft: depth * 14 }} aria-current={page.id === p.id ? 'page' : undefined} onClick={() => selectPage(p)}>{p.kind === 'folder' ? '▸ ' : ''}{p.title}</AsyncButton>{tree(p.id, depth + 1, next)}</div>;
    });
  }
  return <>{!initialPageId && <div className="page-header"><div><h1>Wiki 知识工作台</h1><p className="desc">维护目录、页面和版本。发布后通过 Dify 流水线同步到知识库。</p></div><div><AsyncButton className="btn btn-secondary" disabled={busy} onClick={() => selectPage({ ...blank, kind: 'folder' })}>新建目录</AsyncButton> <AsyncButton className="btn btn-primary" disabled={busy} onClick={() => selectPage({ ...blank, parentId: page.kind === 'folder' ? page.id : page.parentId, datasetId: page.datasetId })}>新建页面</AsyncButton></div></div>}
    {!editorOpen && message && <Feedback message={message} />}
    {!initialPageId && <LoadState loading={loading} error={loadError} onRetry={load}><section className="card rag-panel"><h2>知识目录</h2>{tree()}{!pages.length && <div className="ui-empty"><p>还没有 Wiki 页面，可手动创建或在知识库启用自动生成。</p><AsyncButton className="btn btn-primary" onClick={() => selectPage({ ...blank })}>新建页面</AsyncButton></div>}</section></LoadState>}
    {initialPageId && loadError && <Modal title="Wiki 页面" onClose={() => onClose?.()}><LoadState error={loadError} onRetry={load}>{null}</LoadState></Modal>}
    {editorOpen && <Modal title={page.kind === 'folder' ? '编辑目录' : page.id ? '编辑 Wiki' : '新建 Wiki'} drawer dirty={dirty} onClose={closeEditor}>
    <section className="card rag-panel" style={{ flex: '3 1 500px', minWidth: 0 }}>
      {message && <Feedback message={message} />}
      <fieldset disabled={busy} className="wiki-editor-fields"><label>标题<input className="input" style={{ display: 'block', width: '100%' }} value={page.title} onChange={e => setPage({ ...page, title: e.target.value })} /></label>
      <p><label>所在目录 <select className="select" value={page.parentId ?? ''} onChange={e => setPage({ ...page, parentId: e.target.value })}><option value="">根目录</option>{pages.filter(p => p.kind === 'folder' && p.id !== page.id && p.status !== 'archived').map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label></p>
      {page.kind === 'page' && <><div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}><label>目标知识库 <select className="select" value={page.datasetId} onChange={e => setPage({ ...page, datasetId: e.target.value })}><option value="">请选择</option>{kbs.map(k => <option key={k.datasetId} value={k.datasetId}>{k.name}</option>)}</select></label><label>密级 <select className="select" value={page.secLevel} onChange={e => setPage({ ...page, secLevel: Number(e.target.value) })}><option value={1}>普通</option><option value={2}>内部</option><option value={3}>机密</option></select></label></div><p className="small">访问范围继承目标知识库的租户、角色和部门权限，并受文件密级限制。</p><AsyncButton className="btn btn-secondary" onClick={() => setPreview(!preview)}>{preview ? '继续编辑' : '预览正文'}</AsyncButton><label style={{ display: 'block' }}>正文（Markdown）<textarea className="input" rows={20} style={{ width: '100%', fontFamily: 'monospace' }} value={page.content} onChange={e => setPage({ ...page, content: e.target.value })} /></label></>}
      <p>{dirty ? '有未保存的修改' : '所有修改已保存'}</p><p>当前版本 {page.revision} · 已发布 {page.publishedRevision ?? '尚未发布'} · {page.status}</p><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><AsyncButton className="btn btn-primary" disabled={busy || !page.title.trim()} onClick={() => action(async () => { await save(); })}>保存草稿</AsyncButton>
      <AsyncButton className="btn btn-secondary" disabled={busy || page.kind !== 'page' || !page.title.trim() || !page.content.trim() || !page.datasetId} onClick={() => action(async () => { const saved = dirty || !page.id ? await save() : page; const result = await api<{ page: Page; status: string }>(`/api/v1/tenant/wiki/${saved.id}/publish`, { method: 'POST', body: JSON.stringify({ revision: saved.revision }) }); baseline.current = JSON.stringify(result.page); setPage(result.page); notify('页面已发布，可在知识库查看同步进度'); })}>发布并同步</AsyncButton>
      <AsyncButton className="btn btn-secondary" disabled={busy || !page.id} onClick={() => action(async () => { setVersions(await api<Version[]>(`/api/v1/tenant/wiki/${page.id}/versions`)); setHistoryOpen(true); })}>版本历史</AsyncButton>
      <AsyncButton className="btn btn-secondary" disabled={busy || !page.id} onClick={() => action(async () => { if (!(await confirmAction('归档后该页面将停止检索，确认归档？', { confirmText: '确认归档' }))) return; await api(`/api/v1/tenant/wiki/${page.id}/archive`, { method: 'POST' }); closeEditor(); notify('已归档，相关页面停止检索'); })}>归档</AsyncButton></div>
      {page.id && page.kind === 'page' && <WikiGraph pageId={page.id} revision={page.publishedRevision} />}
      {historyOpen && <Modal title="版本历史" wide dirty={false} onClose={() => setHistoryOpen(false)}><section><h3>版本历史</h3>{versions.map(v => <p key={v.revision}>版本 {v.revision} · {new Date(v.createdAt).toLocaleString()} <AsyncButton className="btn btn-secondary" onClick={() => setCompare(v)}>对比</AsyncButton> <AsyncButton className="btn btn-secondary" disabled={busy} onClick={() => action(async () => { if (dirty && !(await confirmAction('恢复将替换未保存内容，确认继续？', { confirmText: '确认恢复' }))) return; const restored = await api<Page>(`/api/v1/tenant/wiki/${page.id}/restore`, { method: 'POST', body: JSON.stringify({ version: v.revision, revision: page.revision }) }); baseline.current = JSON.stringify(restored); setPage(restored); setCompare(undefined); setHistoryOpen(false); notify('已恢复为新草稿，发布后更新知识索引'); })}>恢复为草稿</AsyncButton></p>)}{!versions.length && <p className="ui-empty">尚无保存的历史版本。</p>}</section></Modal>}
      {compare && <Modal title="版本对比" wide dirty={false} onClose={() => setCompare(undefined)}><section><h3>历史版本 {compare.revision} 与当前草稿</h3><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 }}><div><h4>{compare.title}</h4><Preview text={compare.content} /></div><div><h4>{page.title}</h4><Preview text={page.content} /></div></div></section></Modal>}
    </fieldset></section></Modal>}
    {preview && <Modal title="Wiki 正文预览" wide dirty={false} onClose={() => setPreview(false)}><WikiReader key={page.id ?? 'new'} text={page.content} /></Modal>}
    {pendingPage && <ModalFrame title="有未保存的修改" onClose={() => { setPendingPage(undefined); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="wiki-unsaved-title"><div className="m-head"><h3 id="wiki-unsaved-title">有未保存的修改</h3></div><div className="m-body">切换页面前，可以保存当前修改，或放弃本次编辑。</div><div className="m-foot"><AsyncButton closeDialog className="btn btn-secondary" disabled={busy} onClick={() => setPendingPage(undefined)}>继续编辑</AsyncButton><AsyncButton className="btn btn-secondary" disabled={busy} onClick={() => { selectPage(pendingPage, true); setPendingPage(undefined); }}>放弃修改</AsyncButton><AsyncButton className="btn btn-primary" disabled={busy || !page.title.trim()} onClick={() => action(async () => { await save(); selectPage(pendingPage, true); setPendingPage(undefined); })}>保存后切换</AsyncButton></div></div></ModalFrame>}
    </>;
}
