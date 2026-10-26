import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { CollectionConfig, CollectionFieldRules, Robot } from '../../api/types';
import { AsyncButton, Feedback } from '../../components/Interaction';
import './robot-collection.css';

export const DEFAULT_COLLECTION: CollectionConfig = {
  trigger: 'all',
  prompt: '收集群成员明确报告的任务、需求和问题。仅记录原文明确表达的信息，忽略闲聊、广告和无关内容。',
  constraints: '不得编造或推测。没有说明的字段填 null。每个非空字段附上原文依据。转述或引用中的事项不要当作新的报告。',
  keywords: [],
  fields: [
    { key: 'subject', label: '事项', type: 'string', required: true, description: '简要描述需要处理的事项，不增加原文没有的事实', rules: { mode: 'review', maxLength: 100 } },
    { key: 'description', label: '具体内容', type: 'string', required: true, description: '保留原文中的具体需求或问题' },
    { key: 'owner', label: '负责人', type: 'string', required: false, description: '仅提取原文明示的负责人；不能把发送人默认当作负责人', rules: { sourceLabel: '负责人', maxLength: 100 } },
  ],
};
const labels: Record<string, string> = { processing: '处理中', collected: '已收集', needs_review: '待核对', ignored: '已忽略', failed: '提取失败', blocked: '已拦截' };
type Result = { status: string; reason: string; validationVersion?: number; validationErrors?: Array<{ code: string; message: string; field?: string; itemIndex?: number }>; items: Array<{ values: Record<string, unknown>; evidence: Record<string, string>; missingFields: string[]; reviewFields?: string[] }> };
type RecordRow = Result & { id: string; channel: string; chatId: string; channelUserId: string; sourceMessageId: string; sourceContent: string; createdAt: string; configSnapshot: CollectionConfig; sourceMetadata?: { kind?: string; senderNickname?: string; isSelf?: boolean } | null };

function ValidationErrors({ result }: { result: Result }) {
  return result.validationErrors?.length ? <div role="alert" className="collection-validation-errors"><p>本次结果未被接纳，请检查以下问题。系统不会自动补值、截断或四舍五入。</p><ul>{result.validationErrors.map((error, index) => <li key={index}>{error.itemIndex !== undefined ? `第 ${error.itemIndex + 1} 条结果 · ` : ''}{error.message} <code>{error.code}</code></li>)}</ul></div> : null;
}

function FieldRules({ field, onChange }: { field: CollectionConfig['fields'][number]; onChange: (rules: CollectionFieldRules) => void }) {
  const r = field.rules ?? {};
  const patch = (value: Partial<CollectionFieldRules>) => onChange({ ...r, ...value });
  const numeric = (key: 'minLength' | 'maxLength' | 'minimum' | 'maximum' | 'multiplier', value: string) => patch({ [key]: value === '' ? undefined : Number(value) });
  const list = (value: string) => value.split('\n').map(v => v.trim()).filter(Boolean);
  return <div style={{ marginTop: 12 }}>
    <label>输出校验方式 <select className="select" value={r.mode ?? 'strict'} onChange={e => {
      const next = { ...r, mode: e.target.value as 'strict' | 'review' };
      if (next.mode === 'review') { delete next.sourceUnit; delete next.multiplier; delete next.trueValues; delete next.falseValues; }
      onChange(next);
    }}><option value="strict">严格 · 原文摘录 / 固定规则转换</option><option value="review">归纳 · 必须人工核对</option></select></label>
    <p className="small">严格模式验证值与引用是否一致；不能证明所有业务语义正确。归纳、分类或自然语言推断请选择“归纳”，结果始终进入待核对。</p>
    <label style={{ display: 'block', marginBottom: 12 }}>原文标签（可选） <input className="input" maxLength={50} value={r.sourceLabel ?? ''} onChange={e => patch({ sourceLabel: e.target.value || undefined })} placeholder="例如：负责人" /></label>
    <p className="small">填写后只接受“标签：值”格式，减少姓名、金额等字段串位。引用只填值本身，不能包含标签。</p>
    <details><summary style={{ cursor: 'pointer' }}>取值约束（服务端强制校验）</summary>
      {field.type === 'string' && <>
        <label style={{ display: 'block', marginTop: 12 }}>文本格式 <select className="select" value={r.format ?? 'text'} onChange={e => patch({ format: e.target.value as 'text' | 'date' })}><option value="text">文本</option><option value="date">绝对日期 YYYY-MM-DD</option></select></label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
          <label>最少字符<input className="input" type="number" min={1} max={4000} step={1} value={r.minLength ?? ''} onChange={e => numeric('minLength', e.target.value)} placeholder="1" /></label>
          <label>最多字符<input className="input" type="number" min={1} max={4000} step={1} value={r.maxLength ?? ''} onChange={e => numeric('maxLength', e.target.value)} placeholder="4000" /></label>
        </div>
        <label style={{ display: 'block', marginTop: 12 }}>允许取值（每行一个；留空不限）<textarea className="input" rows={3} style={{ width: '100%', boxSizing: 'border-box' }} value={r.enumValues?.join('\n') ?? ''} onChange={e => patch({ enumValues: e.target.value ? e.target.value.split('\n') : undefined })} onBlur={() => patch({ enumValues: r.enumValues?.some(v => v.trim()) ? list(r.enumValues.join('\n')) : undefined })} /></label>
        {r.format === 'date' && <p className="small">严格模式只转换明确年月日，例如 2026年10月22日 → 2026-10-22；“明天”、缺少年份和无效日期不能推算。</p>}
      </>}
      {field.type === 'number' && <>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
          <label>数值下限<input className="input" type="number" step="any" value={r.minimum ?? ''} onChange={e => numeric('minimum', e.target.value)} /></label>
          <label>数值上限<input className="input" type="number" step="any" value={r.maximum ?? ''} onChange={e => numeric('maximum', e.target.value)} /></label>
          <label><input type="checkbox" checked={r.integer ?? false} onChange={e => patch({ integer: e.target.checked })} /> 只接受整数</label>
        </div>
        {r.mode !== 'review' && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
          <label>原文单位<input className="input" maxLength={50} value={r.sourceUnit ?? ''} onChange={e => patch({ sourceUnit: e.target.value || undefined })} placeholder="例如 万元、台" /></label>
          <label>转换倍率<input className="input" type="number" min={0} max={1e9} step="any" value={r.multiplier ?? ''} onChange={e => numeric('multiplier', e.target.value)} placeholder="1" /></label>
        </div>}
        <p className="small">原文 1.2万元，配置单位“万元”、倍率 10000，输出 12000。上下限检查转换后的值；严格模式不接受中文数字、范围、约数，不自动取整。</p>
      </>}
      {field.type === 'boolean' && r.mode !== 'review' && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
        <label>“是”的原文取值（每行一个）<textarea className="input" rows={3} value={(r.trueValues ?? ['是', 'true']).join('\n')} onChange={e => patch({ trueValues: e.target.value.split('\n') })} onBlur={() => patch({ trueValues: list((r.trueValues ?? ['是', 'true']).join('\n')) })} /></label>
        <label>“否”的原文取值（每行一个）<textarea className="input" rows={3} value={(r.falseValues ?? ['否', 'false']).join('\n')} onChange={e => patch({ falseValues: e.target.value.split('\n') })} onBlur={() => patch({ falseValues: list((r.falseValues ?? ['否', 'false']).join('\n')) })} /></label>
      </div>}
    </details>
  </div>;
}

export function CollectionSettings({ robotId, rag, onChange }: { robotId: string; rag: NonNullable<Robot['ragConfig']>; onChange: (value: NonNullable<Robot['ragConfig']>) => void }) {
  const config = rag.collection ?? DEFAULT_COLLECTION;
  const enabled = rag.mode === 'collector';
  const [sample, setSample] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  useEffect(() => { revision.current++; setResult(null); setError(''); }, [robotId, rag, sample]);
  const change = (patch: Partial<CollectionConfig>) => onChange({ ...rag, collection: { ...config, ...patch } });
  const field = (index: number, patch: Partial<CollectionConfig['fields'][number]>) => change({ fields: config.fields.map((f, i) => i === index ? { ...f, ...patch } : f) });
  async function preview() {
    const current = ++revision.current;
    setBusy(true); setError(''); setResult(null);
    try {
      const value = await api<Result>(`/api/v1/tenant/robots/${robotId}/collection-preview`, { method: 'POST', body: JSON.stringify({ config, content: sample }) });
      if (current === revision.current) setResult(value);
    } catch (e) { if (current === revision.current) setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="card rag-panel" aria-label="信息收集规则">
    <h2>工作模式</h2>
    <label>消息处理方式 <select className="select" value={rag.mode ?? 'qa'} onChange={e => onChange({ ...rag, mode: e.target.value as 'qa' | 'collector', ...(e.target.value === 'collector' ? { collection: config } : {}) })}>
      <option value="qa">问答客服 · 群内 @ 后回答</option><option value="collector">信息收集 · 提取并保存，不回复群聊</option>
    </select></label>
    <p className="small">模式与规则保存并发布后生效。收集模式独立使用本页提示词，不进行知识检索、工具提交或自动转人工。</p>
    {enabled && <>
      <p>在<Link className="link" to="/t/groups">群管理</Link>中将目标群绑定到当前机器人。一群目前只能绑定一个机器人；切换为收集模式后，该群不再执行客服问答。</p>
      <p className="small">收集器只能处理渠道已送达的消息。钉钉标准机器人只投递群内 @ 消息；微信普通群消息需要本地采集插件接入，单独开启此模式不能获取它们。</p>
      <label>触发条件 <select className="select" value={config.trigger} onChange={e => change({ trigger: e.target.value as CollectionConfig['trigger'] })}><option value="all">所有送达的群消息（无需 @）</option><option value="mention">仅 @ 机器人的群消息</option></select></label>
      <label style={{ display: 'block', marginTop: 16 }}>收集提示词<textarea className="input" rows={7} maxLength={12000} style={{ width: '100%', boxSizing: 'border-box' }} value={config.prompt} onChange={e => change({ prompt: e.target.value })} placeholder="描述需要收集什么、哪些消息应忽略，以及如何转换内容。" /></label>
      <label style={{ display: 'block', marginTop: 16 }}>业务约束<textarea className="input" rows={4} maxLength={6000} style={{ width: '100%', boxSizing: 'border-box' }} value={config.constraints} onChange={e => change({ constraints: e.target.value })} placeholder="例如：只收集明确提出的维修需求；不得将报价当作成交；金额单位统一为元。" /></label>
      <label style={{ display: 'block', marginTop: 16 }}>关键词预筛选（每行一个，可留空）<textarea className="input" rows={3} style={{ width: '100%', boxSizing: 'border-box' }} value={config.keywords.join('\n')} onChange={e => change({ keywords: e.target.value.split('\n') })} onBlur={() => change({ keywords: config.keywords.map(k => k.trim()).filter(Boolean) })} /></label>
      <p className="small">命中任一关键词后再交给模型判断；留空表示逐条判断。未命中关键词不消耗 AI 调用额度。最多 20 个关键词。</p>
      <h3>提取字段</h3>
      <p className="small">所有字段必须返回，未知值为 null。错误类型、越界、错误引用或转换会使整条消息提取失败；缺少必填值、使用归纳的结果标记“待核对”。文字提示不能绕过下面的硬约束。</p>
      {config.fields.map((f, index) => <fieldset key={index} style={{ border: '1px solid var(--border)', borderRadius: 8, margin: '12px 0', padding: 16, minWidth: 0 }}>
        <legend>字段 {index + 1}</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <label>显示名称<input className="input" maxLength={100} value={f.label} onChange={e => field(index, { label: e.target.value })} /></label>
          <label>字段标识<input className="input" maxLength={50} value={f.key} onChange={e => field(index, { key: e.target.value })} placeholder="例如 order_id" /></label>
          <label>数据类型<select className="select" value={f.type} onChange={e => field(index, { type: e.target.value as typeof f.type, rules: { mode: f.rules?.mode, sourceLabel: f.rules?.sourceLabel } })}><option value="string">文本</option><option value="number">数字</option><option value="boolean">是 / 否</option></select></label>
          <label style={{ alignSelf: 'center' }}><input type="checkbox" checked={f.required} onChange={e => field(index, { required: e.target.checked })} /> 必填</label>
          <button type="button" className="btn btn-secondary" aria-label={`删除字段 ${f.label || index + 1}`} onClick={() => change({ fields: config.fields.filter((_, i) => i !== index) })}>删除字段</button>
        </div>
        <label style={{ display: 'block', marginTop: 12 }}>提取与转换说明<textarea className="input" rows={2} maxLength={1000} style={{ width: '100%', boxSizing: 'border-box' }} value={f.description} onChange={e => field(index, { description: e.target.value })} /></label>
        <FieldRules field={f} onChange={rules => field(index, { rules })} />
      </fieldset>)}
      <button type="button" className="btn btn-secondary" disabled={config.fields.length >= 20} onClick={() => change({ fields: [...config.fields, { key: '', label: '', type: 'string', required: false, description: '' }] })}>添加字段</button>
      <h3>用一条消息测试规则</h3>
      <p className="small">使用当前未保存的规则测试，只显示预览，不新增收集记录或发送群消息。调用模型会计入租户 AI 额度。第一版按单条文本提取，不跨消息猜测上下文。</p>
      <label>测试消息<textarea className="input" rows={4} maxLength={20000} style={{ width: '100%', boxSizing: 'border-box' }} value={sample} onChange={e => setSample(e.target.value)} placeholder="粘贴一条有代表性的群消息" /></label>
      <AsyncButton className="btn btn-secondary" disabled={busy || !sample.trim() || !config.prompt.trim() || !config.fields.length} onClick={preview}>测试提取</AsyncButton>
      {error && <Feedback message={error} />}
      {result && <div className={`collection-preview-result collection-preview-${result.status}`} aria-live="polite"><p>{labels[result.status] ?? result.status} · {result.reason}</p><ValidationErrors result={result} />{!!result.items.length && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(result.items, null, 2)}</pre>}</div>}
    </>}
  </section>;
}

export function CollectionRecords({ robotId }: { robotId: string }) {
  const [data, setData] = useState<{ items: RecordRow[]; total: number } | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true; setLoading(true); setError(''); setData(null);
    api<{ items: RecordRow[]; total: number }>(`/api/v1/tenant/robots/${robotId}/collections?page=${page}&status=${status}`).then(value => { if (current) setData(value); })
      .catch(e => { if (current) setError(e.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [robotId, page, status, refresh]);
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data?.items ?? [], null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `collection-${robotId}-page-${page}.json`; a.click(); URL.revokeObjectURL(url);
  }
  async function retry(id: string) {
    try { await api(`/api/v1/tenant/robots/${robotId}/collections/${id}/retry`, { method: 'POST' }); setRefresh(v => v + 1); }
    catch (e) { setError((e as Error).message); }
  }
  return <section className="card rag-panel" aria-label="信息收集记录">
    <h2>收集记录</h2><p className="small">每条消息保留原文、来源与当时的收集规则。提取结果可展开核对；“已收集”表示通过格式和引用校验，不代表已经人工确认。</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      <label>记录状态 <select className="select" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">全部</option>{Object.entries(labels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      <AsyncButton className="btn btn-secondary" disabled={loading} onClick={() => setRefresh(v => v + 1)}>刷新记录</AsyncButton>
      <button type="button" className="btn btn-secondary" disabled={!data?.items.length || loading} onClick={download}>导出本页 JSON</button>
    </div>
    {error && <Feedback message={error} />}
    {loading && <p role="status">正在加载收集记录…</p>}
    {!loading && data?.items.length === 0 && <p className="ui-empty">当前条件下暂无记录。发布收集规则、绑定目标群，并接入能够投递群消息的渠道后，结果将在这里显示。</p>}
    {data?.items.map(record => <details key={record.id} style={{ borderBottom: '1px solid var(--border)', padding: '16px 0', overflowWrap: 'anywhere' }}>
      <summary style={{ cursor: 'pointer' }}><strong>{labels[record.status]}</strong> · {new Date(record.createdAt).toLocaleString()} · {record.sourceContent.slice(0, 90)}{record.sourceContent.length > 90 ? '…' : ''}</summary>
      <p className="small">渠道：{record.channel} · 群：{record.chatId} · 发送人：{record.sourceMetadata?.kind === 'desktop_ocr' ? `${record.sourceMetadata.senderNickname || '未知'}${record.sourceMetadata.isSelf ? '（本人）' : ''} · 截图来源，身份未验证` : record.channelUserId} · 消息 ID：{record.sourceMessageId}</p>
      <p>{record.reason}</p><h3>原文</h3><p style={{ whiteSpace: 'pre-wrap' }}>{record.sourceContent}</p>
      {(record.validationVersion ?? 1) < 2 && <p>历史结果尚未经过严格字段校验，不应直接用作已验证的数据。</p>}
      <ValidationErrors result={record} />
      {record.items.map((item, index) => <div key={index}>
        <h3>提取结果 {index + 1}{item.missingFields.length || item.reviewFields?.length ? ' · 需核对' : ''}</h3>
        <div className="ui-table-scroll" tabIndex={0} role="region" aria-label={`提取结果 ${index + 1}`}><table className="data"><thead><tr><th>字段</th><th>转换结果</th><th>原文依据</th></tr></thead><tbody>
          {record.configSnapshot.fields.map(f => <tr key={f.key}><td>{f.label}{item.missingFields.includes(f.key) ? '（待补充）' : item.reviewFields?.includes(f.key) ? '（归纳待核对）' : ''}</td><td>{item.values[f.key] === null ? '未提供' : String(item.values[f.key])}</td><td>{item.evidence[f.key] ?? '—'}</td></tr>)}
        </tbody></table></div>
      </div>)}
      <details><summary>当时使用的收集规则</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(record.configSnapshot, null, 2)}</pre></details>
      {['failed', 'blocked', 'processing'].includes(record.status) && <><p className="small">重试使用原规则快照并计入 AI 额度。处理中超过 5 分钟的记录可恢复重试。</p><AsyncButton className="btn btn-secondary" onClick={() => retry(record.id)}>重试此记录</AsyncButton></>}
    </details>)}
    {data && <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 16 }}><button type="button" className="btn btn-secondary" disabled={loading || page === 1} onClick={() => setPage(v => v - 1)}>上一页</button><span>第 {page} 页 · 共 {data.total} 条</span><button type="button" className="btn btn-secondary" disabled={loading || page * 20 >= data.total} onClick={() => setPage(v => v + 1)}>下一页</button></div>}
  </section>;
}
