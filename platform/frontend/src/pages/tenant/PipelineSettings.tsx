import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { readableFilename } from '../../utils/filename';
import { useFeedback, Feedback, AsyncButton, LoadState, Tabs, notify, useDialogSaved } from '../../components/Interaction';

type Job = { id: string; name: string; status: string; error: string; sourceVersion: string };
type WikiJob = { id: string; name: string; status: string; error: string; page_id?: string; updated_at: string };
const statusLabels: Record<string, string> = { queued: '排队中', running: '处理中', indexing: '索引中', completed: '已完成', failed: '失败', published: '已发布，等待知识索引', review: '待人工审核', archived: '已归档' };

export default function PipelineSettings({ datasetId }: { datasetId: string }) {
  const [node, setNode] = useState(''), [inputs, setInputs] = useState('{}'), [autoWiki, setAutoWiki] = useState(false);
  const [nodes, setNodes] = useState<Array<{ id: string; title?: string }>>([]);
  const [jobs, setJobs] = useState<Job[]>([]), [wikiJobs, setWikiJobs] = useState<WikiJob[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [message, setMessage] = useFeedback();
  const markSaved = useDialogSaved();
  async function load() {
    setLoading(true); setError('');
    try {
      const [config, ingestion, wiki] = await Promise.all([
        api<{ startNodeId?: string; inputs?: object; autoWiki?: boolean }>(`/api/v1/tenant/knowledge/${datasetId}/pipeline`),
        api<Job[]>(`/api/v1/tenant/knowledge/${datasetId}/jobs`),
        api<WikiJob[]>(`/api/v1/tenant/wiki/generation-jobs?datasetId=${datasetId}`),
      ]);
      setNode(config.startNodeId ?? ''); setInputs(JSON.stringify(config.inputs ?? {}, null, 2)); setAutoWiki(config.autoWiki === true);
      setJobs(ingestion); setWikiJobs(wiki);
    } catch (cause) { setError((cause as Error).message); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [datasetId]);
  async function refresh() {
    setMessage('');
    try { const [ingestion, wiki] = await Promise.all([api<Job[]>(`/api/v1/tenant/knowledge/${datasetId}/jobs`), api<WikiJob[]>(`/api/v1/tenant/wiki/generation-jobs?datasetId=${datasetId}`)]); setJobs(ingestion); setWikiJobs(wiki); }
    catch (cause) { setMessage((cause as Error).message); }
  }
  async function action(work: () => Promise<void>) { setMessage(''); try { await work(); } catch (cause) { setMessage((cause as Error).message); } }
  return <LoadState loading={loading} error={error} onRetry={load}><section className="rag-panel">
    {message && <Feedback message={message} />}
    <Tabs param="pipelineTab" items={[
      { id: 'settings', label: '流水线配置', content: <div className="card">
        <h2>Dify 知识流水线</h2><p>文件与 Wiki 共用已发布流水线。句子分隔符、切片长度、清洗和嵌入模型在 Dify 中维护。</p>
        <div className="ui-form-grid"><label>文件数据源节点 ID<input className="input" value={node} onChange={e => setNode(e.target.value)} /></label></div>
        <p><AsyncButton className="btn btn-secondary" onClick={() => action(async () => {
          const result = await api<{ data: Array<{ id: string; title?: string }> } | Array<{ id: string; title?: string }>>(`/api/v1/tenant/knowledge/${datasetId}/pipeline/nodes`);
          const found = Array.isArray(result) ? result : result.data; setNodes(found); if (found.length === 1) setNode(found[0].id);
          if (!found.length) setMessage('没有已发布的数据源，请先在 Dify 发布流水线。');
        })}>读取已发布数据源</AsyncButton></p>
        {!!nodes.length && <label>已发布数据源<select className="select" value={node} onChange={e => setNode(e.target.value)}><option value="">请选择</option>{nodes.map(n => <option key={n.id} value={n.id}>{n.title || n.id}</option>)}</select></label>}
        <label style={{ display: 'block', margin: '16px 0' }}>流水线输入参数（JSON）<textarea className="input" rows={5} style={{ width: '100%' }} value={inputs} onChange={e => setInputs(e.target.value)} /></label>
        <label><input type="checkbox" checked={autoWiki} onChange={e => setAutoWiki(e.target.checked)} /> 根据上传文件自动创建 Wiki</label>
        <p className="small muted">启用后处理本知识库中已完成切片的现有文件和后续上传文件。首次生成的页面自动发布并提交索引；已人工修改的草稿保留待审核，已归档页面不重新发布。</p>
        <AsyncButton className="btn btn-primary" disabled={!node.trim()} onClick={() => action(async () => {
          let parsed: unknown; try { parsed = JSON.parse(inputs); } catch { throw new Error('输入参数格式不正确，请使用有效的 JSON 对象。'); }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('输入参数必须是 JSON 对象，例如 {}。');
          await api(`/api/v1/tenant/knowledge/${datasetId}/pipeline`, { method: 'PUT', body: JSON.stringify({ startNodeId: node.trim(), inputs: parsed, autoWiki }) }); markSaved(); notify('流水线配置已保存');
        })}>保存配置</AsyncButton>
      </div> },
      { id: 'ingestion', label: '入库任务', badge: jobs.length, content: <div className="card"><div className="page-header"><h2>入库任务</h2><AsyncButton className="btn btn-secondary" onClick={refresh}>刷新状态</AsyncButton></div>
        {!jobs.length ? <p className="ui-empty">暂无入库任务。绑定流水线后上传文件或发布 Wiki 页面。</p> : <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="入库任务"><table className="data"><thead><tr><th>内容</th><th>状态</th><th>说明</th><th>操作</th></tr></thead><tbody>{jobs.map(j => <tr key={j.id}><td>{readableFilename(j.name)}</td><td>{statusLabels[j.status] ?? j.status}</td><td>{j.error || '—'}</td><td>{j.status === 'failed' && <AsyncButton className="btn btn-secondary" onClick={() => action(async () => { await api(`/api/v1/tenant/knowledge/${datasetId}/jobs/${j.id}/retry`, { method: 'POST' }); await refresh(); notify('已提交重试'); })}>重试入库</AsyncButton>}</td></tr>)}</tbody></table></div>}
      </div> },
      { id: 'wiki', label: 'Wiki 生成', badge: wikiJobs.length, content: <div className="card"><div className="page-header"><h2>Wiki 生成任务</h2><AsyncButton className="btn btn-secondary" onClick={refresh}>刷新状态</AsyncButton></div>
        <p className="small muted">已发布表示已提交知识索引，是否可检索请结合入库任务状态确认。</p>
        {!wikiJobs.length ? <p className="ui-empty">暂无生成任务。在流水线配置中启用自动创建 Wiki 后，后台会处理已完成切片的文件。</p> : <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="Wiki 生成任务"><table className="data"><thead><tr><th>源文件</th><th>状态</th><th>更新时间</th><th>说明</th><th>操作</th></tr></thead><tbody>{wikiJobs.map(j => <tr key={j.id}><td>{readableFilename(j.name)}</td><td>{statusLabels[j.status] ?? j.status}</td><td>{new Date(j.updated_at).toLocaleString()}</td><td>{j.error || '—'}</td><td>{j.status === 'failed' && <AsyncButton className="btn btn-secondary" onClick={() => action(async () => { await api(`/api/v1/tenant/wiki/generation-jobs/${j.id}/retry`, { method: 'POST' }); await refresh(); notify('已提交 Wiki 生成重试'); })}>重试生成</AsyncButton>}</td></tr>)}</tbody></table></div>}
      </div> },
    ]} />
  </section></LoadState>;
}
