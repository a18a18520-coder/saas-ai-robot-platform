import { useFeedback, Feedback, AsyncButton, Modal, Tabs, LoadState, notify } from '../../components/Interaction';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import './evaluations.css';

type Case = { id: string; robotId: string; question: string; expectedAnswer: string; channelUserId: string; channel: string };
type Run = { id: string; caseId: string; robotId: string; status: string; result: { engine?: string; version?: string; stage?: string; scores?: Record<string, number | null>; delta?: Record<string, number | null>; errors?: Record<string, string>; error?: string; answer?: string; contexts?: string[]; recommendations?: string[]; proposal?: { prompt: string; reason: string }; rubric?: string; comparisonNote?: string; adoptedAt?: string; durationMs?: number; citations?: unknown; correctness?: number; completeness?: number }; createdAt: string; snapshot: { baselineId?: string; candidatePrompt?: string; test?: Case } };
const metrics = [['faithfulness', '知识忠实度'], ['factual_correctness', '事实正确性'], ['context_precision', '检索精度'], ['context_recall', '检索覆盖率']] as const;
const stateNames: Record<string, string> = { running: '运行中', completed: '已完成', partial: '部分完成', failed: '失败' };
const stages: Record<string, string> = { retrieval: '检索与回答', ...Object.fromEntries(metrics), done: '已完成' };
const score = (n: number | null | undefined) => typeof n === 'number' ? (n * 100).toFixed(0) + '%' : '未完成';
const emptyForm = { robotId: '', question: '', expectedAnswer: '', channelUserId: '', channel: 'dingtalk', documents: '' };

export default function Evaluations() {
  const [cases, setCases] = useState<Case[]>([]), [runs, setRuns] = useState<Run[]>([]), [robots, setRobots] = useState<Array<{ id: string; name: string }>>([]);
  const [engine, setEngine] = useState<{ available: boolean; version?: string; message?: string }>();
  const [form, setForm] = useState(emptyForm), [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [message, setMessage] = useFeedback(), [busy, setBusy] = useState(false), [selectedId, setSelectedId] = useState<string>();
  const [prompt, setPrompt] = useState(''), [adopted, setAdopted] = useState(false);
  const selected = runs.find(r => r.id === selectedId);
  const running = runs.some(r => r.status === 'running');
  async function load() {
    setLoading(true); setLoadError('');
    try {
      const [c, r, b, e] = await Promise.all([api<Case[]>('/api/v1/tenant/evaluations'), api<Run[]>('/api/v1/tenant/evaluations/runs'), api<Array<{ id: string; name: string }>>('/api/v1/tenant/robots'), api<{ available: boolean; version?: string; message?: string }>('/api/v1/tenant/evaluations/engine')]);
      setCases(c); setRuns(r); setRobots(b); setEngine(e);
    } catch (e) { setLoadError((e as Error).message); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!running) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await api<Run[]>('/api/v1/tenant/evaluations/runs'); if (!disposed) setRuns(next); }
      catch (e) { if (!disposed) setMessage('进度更新失败：' + (e as Error).message); }
      if (!disposed) timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 3000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [running]);
  function open(run: Run) { setSelectedId(run.id); setPrompt(run.result.proposal?.prompt ?? ''); setAdopted(!!run.result.adoptedAt); setMessage(''); }
  function merge(run: Run) { setRuns(prev => [run, ...prev.filter(r => r.id !== run.id)]); }
  async function action(work: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await work(); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  async function start(caseId: string, baselineId?: string) {
    const run = await api<Run>(`/api/v1/tenant/evaluations/${caseId}/run`, { method: 'POST', body: JSON.stringify(baselineId ? { baselineId, candidatePrompt: prompt } : {}) });
    merge(run); open(run); notify('评测已开始，可关闭详情稍后查看', 'info');
  }
  return <>
    <div className="page-header"><div><h1>回答评测</h1><p className="desc">标准问答 → 真实检索评测 → 调优草案 → 复测对比</p></div><AsyncButton className="btn btn-primary" onClick={() => { setMessage(''); setCreating(true); }}>新增用例</AsyncButton></div>
    {message && <Feedback message={message} />}
    <LoadState loading={loading} error={loadError} onRetry={load}>
      <div className="eval-engine" role="status"><strong>{engine?.available ? `Ragas ${engine.version} 已就绪` : 'Ragas 未就绪'}</strong><span>{engine?.message ?? '沿用平台配置的租户模型。评测消耗模型额度，不向渠道发消息。'}</span></div>
      <Tabs items={[
        { id: 'cases', label: '测试用例', badge: cases.length, content: <section className="card">
          <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="评测用例"><table className="data eval-table"><thead><tr><th>问题</th><th>机器人</th><th>测试渠道</th><th>测试身份</th><th>操作</th></tr></thead><tbody>{cases.map(c => <tr key={c.id}><td title={c.question}>{c.question}</td><td>{robots.find(r => r.id === c.robotId)?.name ?? '未知机器人'}</td><td>{c.channel}</td><td title={c.channelUserId}>{c.channelUserId}</td><td><AsyncButton className="btn btn-secondary" disabled={busy || running || !engine?.available} onClick={() => action(() => start(c.id))}>运行评测</AsyncButton></td></tr>)}</tbody></table></div>
          {!cases.length && <p className="ui-empty">添加问题、人工确认的标准答案和测试身份，开始第一轮评测。</p>}
          <p className="desc">按测试身份的真实权限运行，每个用例使用独立会话。启用的只读工具可能被调用。每个租户同时运行一个用例。</p>
        </section> },
        { id: 'runs', label: '运行记录', badge: runs.length, content: <section className="card"><div className="ui-table-scroll" tabIndex={0} role="region" aria-label="评测运行记录"><table className="data eval-table"><thead><tr><th>问题</th><th>时间</th><th>状态</th>{metrics.map(([key, name]) => <th key={key}>{name}</th>)}<th>操作</th></tr></thead><tbody>{runs.map(r => <tr key={r.id}><td title={r.snapshot.test?.question}>{r.snapshot.test?.question ?? cases.find(c => c.id === r.caseId)?.question}{r.snapshot.baselineId ? ' · 复测' : ''}</td><td>{new Date(r.createdAt).toLocaleString()}</td><td>{stateNames[r.status] ?? r.status}</td>{metrics.map(([key]) => <td key={key}>{r.result.engine === 'ragas' ? score(r.result.scores?.[key]) : '旧版评分'}</td>)}<td><AsyncButton className="btn btn-secondary" onClick={() => open(r)}>查看详情</AsyncButton></td></tr>)}</tbody></table></div>{!runs.length && <p className="ui-empty">暂无记录，运行测试用例后查看评分与调优建议。</p>}</section> },
      ]} />
    </LoadState>
    {creating && <Modal title="新增标准问答" onClose={() => setCreating(false)}>
      <form className="eval-form" onSubmit={e => { e.preventDefault(); void action(async () => {
        const item = await api<Case>('/api/v1/tenant/evaluations', { method: 'POST', body: JSON.stringify({ ...form, expectedDocuments: form.documents.split(/[,，]/).map(v => v.trim()).filter(Boolean) }) });
        setCases(prev => [...prev, item]); setForm(emptyForm); setCreating(false); notify('用例已保存');
      }); }}>
        <label>机器人<select className="select" required value={form.robotId} onChange={e => setForm({ ...form, robotId: e.target.value })}><option value="">请选择</option>{robots.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label>问题<textarea className="input" required maxLength={4000} rows={2} value={form.question} onChange={e => setForm({ ...form, question: e.target.value })} /></label>
        <label>标准答案<textarea className="input" required maxLength={12000} rows={4} placeholder="填写人工核对过的答案，评分以此为准" value={form.expectedAnswer} onChange={e => setForm({ ...form, expectedAnswer: e.target.value })} /></label>
        <label>测试身份<input className="input" required value={form.channelUserId} placeholder="渠道用户 ID" onChange={e => setForm({ ...form, channelUserId: e.target.value })} /></label>
        <label>身份渠道<select className="select" value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })}>{['web', 'wecom', 'dingtalk', 'feishu'].map(c => <option key={c}>{c}</option>)}</select></label>
        <label>预期文档<input className="input" placeholder="可选，文档 ID 用逗号分隔" value={form.documents} onChange={e => setForm({ ...form, documents: e.target.value })} /></label>
        <p className="desc">使用测试身份的知识权限。预期文档用于引用覆盖率，独立于 Ragas 检索指标。</p>
        <div className="eval-actions"><AsyncButton type="submit" className="btn btn-primary" disabled={busy || !form.robotId || !form.question.trim() || !form.expectedAnswer.trim() || !form.channelUserId.trim()}>保存用例</AsyncButton></div>
      </form>
    </Modal>}
    {selected && <Modal title="评测结果" wide onClose={() => setSelectedId(undefined)}>
      <div className="eval-detail">
        <p className="eval-question">{selected.snapshot.test?.question ?? cases.find(c => c.id === selected.caseId)?.question}</p>
        <p role="status">{stateNames[selected.status]}{selected.status === 'running' ? ' · ' + (stages[selected.result.stage ?? 'retrieval'] ?? '计算指标') + '，可关闭窗口稍后查看。' : ''}</p>
        {selected.result.error && <p className="ui-form-error" role="alert">{selected.result.error}</p>}
        {selected.result.engine === 'ragas' || selected.status === 'running' ? <div className="eval-scores">{metrics.map(([key, name]) => <div key={key}><span>{name}</span><strong>{score(selected.result.scores?.[key])}</strong>{typeof selected.result.delta?.[key] === 'number' && <small>较基线 {selected.result.delta[key]! >= 0 ? '+' : ''}{(selected.result.delta[key]! * 100).toFixed(1)} 个百分点</small>}{selected.result.errors?.[key] && <small>{selected.result.errors[key]}</small>}</div>)}</div> : <p>这是旧版模型辅助评分，不属于 Ragas。正确性：{selected.result.correctness ?? '—'}；完整性：{selected.result.completeness ?? '—'}。</p>}
        <h3>实际回答</h3><p className="eval-prose">{selected.result.answer ?? '等待生成'}</p>
        <h3>标准答案</h3><p className="eval-prose">{selected.snapshot.test?.expectedAnswer ?? '—'}</p>
        {!!selected.result.recommendations?.length && <><h3>调优建议</h3><ul>{selected.result.recommendations.map(text => <li key={text}>{text}</li>)}</ul></>}
        <p className="desc">{selected.result.rubric}</p>
        {selected.snapshot.baselineId && <p className="desc">{selected.result.comparisonNote ?? '请对照基线的证据和配置快照；单次模型评分存在波动，不能单凭分差认定调优有效。'}</p>}
        {['completed', 'partial'].includes(selected.status) && selected.result.engine === 'ragas' && <section className="eval-tuning">
          <h3>提示词调优</h3><p className="desc">草案仅在复测中使用。检索、权限或切片问题需要在对应配置中修复，提示词不能补齐缺失知识。</p>
          <AsyncButton className="btn btn-secondary" disabled={busy || running} onClick={() => action(async () => { const next = await api<Run>(`/api/v1/tenant/evaluations/runs/${selected.id}/proposal`, { method: 'POST' }); merge(next); setPrompt(next.result.proposal?.prompt ?? ''); notify('调优草案已生成'); })}>生成草案</AsyncButton>
          {selected.result.proposal && <><p className="eval-prose">{selected.result.proposal.reason}</p><label className="eval-prompt">复测提示词<textarea className="input" rows={10} maxLength={12000} value={prompt} onChange={e => setPrompt(e.target.value)} /></label><AsyncButton className="btn btn-primary" disabled={busy || running || !prompt.trim()} onClick={() => action(() => start(selected.caseId, selected.id))}>复测草案</AsyncButton></>}
          {selected.snapshot.candidatePrompt && selected.status === 'completed' && <div className="eval-actions"><AsyncButton className="btn btn-primary" disabled={busy || adopted} onClick={() => action(async () => { await api(`/api/v1/tenant/evaluations/runs/${selected.id}/adopt`, { method: 'POST' }); setAdopted(true); notify('已保存机器人草稿，审核发布后生效'); })}>{adopted ? '已存草稿' : '存为草稿'}</AsyncButton><Link className="btn btn-secondary" to={`/t/robots/${selected.robotId}`}>机器人配置</Link></div>}
        </section>}
        <details><summary>检索证据与配置快照</summary>{selected.result.contexts?.map((text, index) => <p className="eval-prose" key={index}>[{index + 1}] {text}</p>)}<pre className="eval-prose">{JSON.stringify({ citations: selected.result.citations, snapshot: selected.snapshot }, null, 2)}</pre></details>
        {selected.status === 'failed' && <AsyncButton className="btn btn-secondary" disabled={busy || running || !engine?.available} onClick={() => action(() => start(selected.caseId))}>重新评测</AsyncButton>}
      </div>
    </Modal>}
  </>;
}
