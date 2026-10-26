import { useFeedback, PageData, Feedback, AsyncButton, Modal, notify } from '../../components/Interaction';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import './follow-ups.css';

interface FollowUp {
  id: string; robotId?: string; channel: string; channelUserId: string; question: string;
  status: 'pending' | 'followed' | 'closed'; note?: string; createdAt: string;
  resolution?: { answer?: string; answeredAt?: string; answeredBy?: string; datasetId?: string; secLevel?: number; jobId?: string; saveToKnowledge?: boolean };
  knowledge?: { status: string; error?: string; documentId?: string };
  chatId?: string;
  delivery?: { channelId?: string; state?: string; handoff?: string; error?: string; sentAt?: string };
}
type Target = { id: string; name: string; ready: boolean };
const channels: Record<string, string> = { wecom: '企业微信', dingtalk: '钉钉', feishu: '飞书', web: '网页' };
const statuses: Record<string, string> = { pending: '待跟进', followed: '已回答', closed: '已关闭' };
const jobs: Record<string, string> = { queued: '待入库', running: '切片处理中', indexing: '索引中', completed: '已入库', failed: '入库失败', uncertain: '需核对提交结果', superseded: '已被新版替代' };

export default function FollowUps() {
  const [items, setItems] = useState<FollowUp[]>([]), [status, setStatus] = useState('pending');
  const [message, setMessage] = useFeedback(), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<FollowUp>(), [targets, setTargets] = useState<Target[]>([]), [targetLoading, setTargetLoading] = useState(false), [targetError, setTargetError] = useState('');
  const [answer, setAnswer] = useState(''), [note, setNote] = useState(''), [store, setStore] = useState(false), [datasetId, setDatasetId] = useState(''), [secLevel, setSecLevel] = useState(1);
  const [pageLoad, setPageLoad] = useState({ loading: true, ready: false, error: '' });
  const [replyGroup, setReplyGroup] = useState(false);
  async function load() {
    setPageLoad(old => ({ ...old, loading: true, error: '' }));
    try { setItems(await api<FollowUp[]>('/api/v1/tenant/follow-ups?status=' + status)); setPageLoad({ loading: false, ready: true, error: '' }); }
    catch (e) { setPageLoad(old => ({ ...old, loading: false, error: (e as Error).message })); }
  }
  useEffect(() => { void load(); }, [status]);
  useEffect(() => {
    setSelected(current => {
      if (!current) return current;
      const fresh = items.find(item => item.id === current.id);
      return fresh ? { ...current, knowledge: fresh.knowledge } : current;
    });
  }, [items]);
  const pendingJobs = items.some(item => ['queued', 'running', 'indexing'].includes(item.knowledge?.status ?? ''));
  useEffect(() => {
    if (!pendingJobs) return;
    let stopped = false;
    const timer = setInterval(() => { api<FollowUp[]>('/api/v1/tenant/follow-ups?status=' + status).then(rows => { if (!stopped) setItems(rows); }).catch(e => { if (!stopped) setMessage('入库状态刷新失败：' + e.message); }); }, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [pendingJobs, status]);
  async function open(item: FollowUp) {
    setReplyGroup(item.channel === 'dingtalk' && !!item.chatId && !!item.delivery?.channelId && item.delivery?.state !== 'sent');
    setMessage(''); setSelected(item); setAnswer(item.resolution?.answer ?? ''); setNote(item.note ?? ''); setStore(false); setDatasetId(item.resolution?.datasetId ?? ''); setSecLevel(item.resolution?.secLevel ?? 1); setTargets([]); setTargetError(''); setTargetLoading(true);
    try { const list = await api<Target[]>('/api/v1/tenant/follow-ups/' + item.id + '/knowledge-targets'); setTargets(list); if (!item.resolution?.datasetId && list.length === 1) setDatasetId(list[0].id); }
    catch (e) { setTargetError((e as Error).message); } finally { setTargetLoading(false); }
  }
  async function save() {
    if (!selected) return;
    setBusy(true); setMessage('');
    try {
      await api('/api/v1/tenant/follow-ups/' + selected.id + '/answer', { method: 'POST', body: JSON.stringify({ answer, note, saveToKnowledge: store, ...(store ? { datasetId, secLevel } : {}) }) });
      if (replyGroup) await api('/api/v1/tenant/follow-ups/' + selected.id + '/reply', { method: 'POST', body: '{}' });
      notify(replyGroup ? '回答已保存，机器人已发送至原群' : store ? '回答已保存并提交切片，索引完成后可检索' : '人工回答已保存');
      setSelected(undefined); if (status !== 'followed') setStatus('followed'); else await load();
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  async function close(item: FollowUp) {
    setMessage(''); try { await api('/api/v1/tenant/follow-ups/' + item.id + '/close', { method: 'POST', body: '{}' }); notify('已关闭'); await load(); } catch (e) { setMessage((e as Error).message); }
  }
  async function confirmDelivery(received: boolean) {
    if (!selected) return;
    try {
      const fresh = await api<FollowUp>('/api/v1/tenant/follow-ups/' + selected.id + '/reply-confirmation', { method: 'POST', body: JSON.stringify({ received }) });
      setSelected(fresh); setReplyGroup(!received); setMessage('核对结果已保存'); await load();
    } catch (e) { setMessage((e as Error).message); }
  }
  return <><PageData state={pageLoad} onRetry={load}>
    <div className="page-header"><div><h1>待跟进</h1><p className="desc">人工确认回答，可由机器人回复原钉钉群，并选择是否沉淀到知识库。</p></div><label>处理状态 <select className="select" value={status} onChange={e => setStatus(e.target.value)}><option value="pending">待跟进</option><option value="followed">已回答</option><option value="closed">已关闭</option><option value="">全部</option></select></label></div>
    {message && <Feedback message={message} />}
    <section className="card"><div className="ui-table-scroll" tabIndex={0} role="region" aria-label="待跟进列表"><table className="data followup-table"><thead><tr><th>问题内容</th><th>来源渠道</th><th>提问时间</th><th>处理状态</th><th>知识入库</th><th>操作</th></tr></thead><tbody>
      {items.map(item => <tr key={item.id}><td title={item.question}>{item.question}</td><td>{channels[item.channel] ?? item.channel}</td><td title={new Date(item.createdAt).toLocaleString()}>{new Date(item.createdAt).toLocaleString()}</td><td>{statuses[item.status]}</td><td title={item.knowledge?.error}>{item.resolution?.saveToKnowledge === false && item.knowledge ? '本次未入库' : jobs[item.knowledge?.status ?? ''] ?? '未入库'}</td><td><div className="followup-actions"><AsyncButton className="btn btn-primary btn-sm" onClick={() => open(item)}>{item.resolution?.answer ? '查看回答' : '人工回答'}</AsyncButton>{item.status !== 'closed' && <AsyncButton className="btn btn-secondary btn-sm" onClick={() => close(item)}>关闭</AsyncButton>}</div></td></tr>)}
    </tbody></table></div>{!items.length && <p className="ui-empty">暂无对应状态的记录。</p>}</section>
  </PageData>
  {selected && <Modal title="人工回答与知识入库" wide onClose={() => { if (!busy) setSelected(undefined); }}>
    <form className="followup-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      <section><h3>客户问题</h3><p className="followup-prose">{selected.question}</p><p className="desc">来源：{channels[selected.channel] ?? selected.channel} · 用户：{selected.channelUserId}</p></section>
      {selected.delivery?.handoff && <p className="desc">客服通知：{selected.delivery.handoff}</p>}
      {selected.delivery?.state && <p role="status">群回复：{({ sending: '发送中；超过五分钟仍无结果时，请核对原群后确认', sent: '已发送', failed: '发送失败，可重试', uncertain: '结果待核对，请检查原群消息' } as Record<string, string>)[selected.delivery.state]} {selected.delivery.error}</p>}
      {['sending', 'uncertain'].includes(selected.delivery?.state ?? '') && <div className="followup-actions"><AsyncButton className="btn btn-secondary" onClick={() => confirmDelivery(true)}>已核对，群内已收到</AsyncButton><AsyncButton className="btn btn-secondary" onClick={() => confirmDelivery(false)}>已核对，群内未收到</AsyncButton></div>}
      {message && <Feedback message={message} />}
      <label>人工回答<textarea className="input" rows={9} required maxLength={20000} value={answer} onChange={e => setAnswer(e.target.value)} placeholder="填写经人工核对的完整答案，保留必要条件与例外" /></label>
      <label>内部备注<textarea className="input" rows={2} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} placeholder="备注不会写入知识库" /></label>
      <label className="followup-check"><input type="checkbox" checked={store} onChange={e => setStore(e.target.checked)} />确认将本次问题和回答存入知识库</label>
      {selected.channel === 'dingtalk' && selected.chatId && (selected.delivery?.channelId ? <label className="followup-check"><input type="checkbox" checked={replyGroup} onChange={e => setReplyGroup(e.target.checked)} />保存后由机器人回复原群</label> : <p className="desc">此历史记录未保存原渠道，暂不能直接回复原群。</p>)}
      {store && <section className="followup-knowledge"><label>目标知识库<select className="select" required value={datasetId} disabled={targetLoading || !!selected.resolution?.datasetId} onChange={e => setDatasetId(e.target.value)}><option value="">请选择对应知识库</option>{targets.map(t => <option key={t.id} value={t.id} disabled={!t.ready}>{t.name}{t.ready ? '' : '（尚未配置切片流水线）'}</option>)}</select></label><label>知识密级<select className="select" value={secLevel} onChange={e => setSecLevel(Number(e.target.value))}><option value={1}>L1 · 普通</option><option value={2}>L2 · 内部</option><option value={3}>L3 · 机密</option></select></label><p className="desc">只可选择此机器人关联的知识库，沿用其 Dify 切片配置和检索权限。首次新增独立问答条目，后续修订更新同一条目；索引成功后替换旧版本。</p>{targetLoading && <p role="status">正在读取知识库…</p>}{targetError && <p role="alert" className="ui-form-error">{targetError}</p>}{!targetLoading && !targetError && !targets.length && <p className="ui-form-error">该机器人尚未关联知识库，请先完成机器人知识范围配置。</p>}</section>}
      {selected.resolution?.datasetId && <section><p>上次入库：{jobs[selected.knowledge?.status ?? ''] ?? '等待状态同步'}</p>{selected.knowledge?.error && <p role="alert" className="ui-form-error">{selected.knowledge.error}</p>}<p className="desc">本次不勾选入库时，原知识版本仍会保留。</p><Link to={'/t/knowledge/' + selected.resolution.datasetId}>查看知识库与入库任务</Link></section>}
      <div className="followup-actions"><AsyncButton type="submit" className="btn btn-primary" disabled={busy || !answer.trim() || ['sending', 'uncertain'].includes(selected.delivery?.state ?? '') || (store && (targetLoading || !targets.some(t => t.id === datasetId && t.ready)))}>{replyGroup ? '保存并回复原群' : store ? '保存并入库' : '保存回答'}</AsyncButton></div>
    </form>
  </Modal>}</>;
}
