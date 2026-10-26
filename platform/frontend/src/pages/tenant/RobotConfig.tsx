import { useFeedback, Feedback, Tabs, AsyncButton, useDialogSaved, notify } from '../../components/Interaction';
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, CURRENT_TENANT_ID } from '../../api/client';
import type { Robot } from '../../api/types';
import RobotTokenUsage from './RobotTokenUsage';
import { CollectionRecords, CollectionSettings, DEFAULT_COLLECTION } from './RobotCollection';

const TID = CURRENT_TENANT_ID;

interface KbItem { id: string; datasetId: string; name: string; visibility: string }
interface ToolItem { id: string; name: string; identifier: string }
interface Resource { resourceId: string; resourceName?: string }

// 例外：保留既有深链接，支持收藏和直接访问；列表入口使用抽屉。
export default function RobotConfig({ robotId, onClose }: { robotId?: string; onClose?: () => void } = {}) {
  const params = useParams();
  const id = robotId ?? params.id ?? '';
  const markSaved = useDialogSaved();
  const [robot, setRobot] = useState<Robot | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState('客服机器人');
  const [desc, setDesc] = useState('');
  const [appId, setAppId] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [kbs, setKbs] = useState<KbItem[]>([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [selKbs, setSelKbs] = useState<string[]>([]);
  const [selTools, setSelTools] = useState<string[]>([]);
  const [handoff, setHandoff] = useState(true);
  const [fallback, setFallback] = useState('抱歉，我暂时没找到答案，已通知客服为您处理，请稍候~');
  const [rag, setRag] = useState<NonNullable<Robot['ragConfig']>>({ topK: 5, historyTurns: 4, compressionThreshold: 0.6 });
  const [wikiPages, setWikiPages] = useState<Array<{ id: string; title: string; kind: string; status: string }>>([]);
  const [models, setModels] = useState<Array<{ id: string; name: string; purpose: string }>>([]);
  const [modelPolicy, setModelPolicy] = useState<NonNullable<Robot['ragConfig']>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useFeedback();

  useEffect(() => {
    api<Robot>(`/api/v1/tenant/robots/${id}`).then((r) => {
      setRobot(r);
      setRag(r.ragConfig ?? { topK: 5, historyTurns: 4, compressionThreshold: 0.6 });
      setName(r.name); setType(r.type); setDesc(r.description ?? '');
      setAppId(r.difyAppId ?? ''); setWorkflowId(r.workflowId ?? '');
      setSelKbs(r.kbPool ?? []);
      setSelTools(r.toolIdentifiers ?? []);
      setHandoff(r.humanHandoff?.enabled ?? true);
      setFallback(r.humanHandoff?.fallback ?? '抱歉，我暂时没找到答案，已通知客服为您处理，请稍候~');
    }).catch(e => setMsg(e.message));
    api<Array<{ id: string; title: string; kind: string; status: string }>>('/api/v1/tenant/wiki').then(setWikiPages).catch(e => setMsg(e.message));
    api<Array<{ id: string; name: string; purpose: string }>>('/api/v1/tenant/models').then(setModels).catch(e => setMsg(e.message));
    api<NonNullable<Robot['ragConfig']>>('/api/v1/tenant/models/policy').then(setModelPolicy).catch(e => setMsg(e.message));
    // 真实数据源：知识库（本地管控）、工具（租户工具）、平台分配资源
    api<KbItem[]>(`/api/v1/tenant/knowledge-base?tenantId=${TID}`).then(setKbs).catch(e => setMsg(e.message));
    api<ToolItem[]>(`/api/v1/tenant/tools?tenantId=${TID}`).then(setTools).catch(e => setMsg(e.message));
    api<Resource[]>(`/api/v1/tenant/dify/resources?tenantId=${TID}`).then(setResources).catch(e => setMsg(e.message));
  }, [id]);

  async function save(publish = false) {
    setBusy(true);
    try {
      const tenantRules = { ...rag };
      delete tenantRules.primaryModelId;
      delete tenantRules.fallbackModelId;
      delete tenantRules.rerankModelId;
      const updated = await api<Robot>(`/api/v1/tenant/robots/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name, type, description: desc || undefined,
          ragConfig: tenantRules, kbPool: selKbs, toolIdentifiers: selTools,
          humanHandoff: { enabled: handoff, fallback },
        }),
      });
      setRobot(updated);
      if (publish) { setRobot(await api<Robot>(`/api/v1/tenant/robots/${id}/publish`, { method: 'POST' })); }
      markSaved(); setMsg(''); notify(publish ? '机器人已发布' : '草稿已保存，发布后生效');
    } catch (e) { setMsg('❌ ' + (e as Error).message); } finally { setBusy(false); }
  }

  const toggle = (arr: string[], v: string) => arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  return (
    <>
      <div className="page-header robot-config-header">
        <div>
          {!onClose && <Link to="/t/robots" className="link small">← 返回机器人列表</Link>}
          <h1 style={{ marginTop: 4 }}>机器人配置 — {robot?.name ?? '加载中…'}
            <span className={`badge ${robot?.status === 'PUBLISHED' ? 'badge-success' : robot?.status === 'DISABLED' ? 'badge-warning' : 'badge-neutral'}`} style={{ marginLeft: 8, verticalAlign: 'middle' }}>
              {robot?.status === 'PUBLISHED' ? '已发布' : robot?.status === 'DISABLED' ? '已禁用' : '草稿'}
            </span>
          </h1>
          <div className="desc">配置问答或信息收集模式，保存草稿后发布生效</div>
        </div>
        <div className="robot-config-actions">
          {onClose ? <AsyncButton closeDialog className="btn btn-secondary" onClick={onClose}>关闭</AsyncButton> : <Link to="/t/robots" className="btn btn-secondary">返回列表</Link>}
          <AsyncButton className="btn btn-secondary" disabled={busy || !robot || !name.trim()} onClick={() => save()}>保存草稿</AsyncButton>
          <AsyncButton className="btn btn-primary" disabled={busy || !robot || !name.trim()} onClick={() => save(true)}>保存并发布</AsyncButton>
        </div>
      </div>

      {msg && <Feedback message={msg} />}
      <Tabs param="robotTab" items={[{ id: 'basics', label: '基础绑定', content: <><div className="card rag-panel" style={{ marginBottom: 16 }}>
            <div className="card-title" style={{ marginBottom: 12 }}>① 基础信息</div>
            <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>机器人名称</div>
            <input className="input" style={{ width: '100%', marginBottom: 10 }} value={name} onChange={(e) => setName(e.target.value)} />
            <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>类型</div>
            <select className="select" style={{ width: '100%', marginBottom: 10 }} value={type} onChange={(e) => { setType(e.target.value); setRag({ ...rag, mode: e.target.value === '信息收集机器人' ? 'collector' : 'qa', ...(e.target.value === '信息收集机器人' ? { collection: rag.collection ?? DEFAULT_COLLECTION } : {}) }); }}>
              <option>客服机器人</option><option>内部知识机器人</option><option>运营机器人</option><option>信息收集机器人</option>
            </select>
            <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>使用场景描述</div>
            <textarea className="input" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="如：面向客服的订单问题解答机器人" style={{ width: '100%', padding: 10, fontFamily: 'inherit' }} />
          </div><div className="card rag-panel">
            <div className="card-title" style={{ marginBottom: 12 }}>② AI 绑定（平台分配资源）</div>
            <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>Dify App</div>
            <select className="select" style={{ width: '100%' }} value={appId} disabled>
              <option value="">选择 App…</option>
              {resources.map((r) => <option key={r.resourceId} value={r.resourceId}>{r.resourceName ?? r.resourceId.slice(0, 12)}</option>)}
            </select>
            <div className="small" style={{ margin: '10px 0 6px', color: 'var(--text-primary)', fontWeight: 500 }}>Workflow（高级路由，可选）</div>
            <input className="input" style={{ width: '100%' }} placeholder="Workflow ID（身份→App/Workflow 高级路由）" value={workflowId} readOnly />
            <div className="small muted" style={{ marginTop: 8 }}>Agent / Workflow 由平台管理员为当前机器人单独配置，租户仅可查看。</div>
          </div></> },
{ id: 'collection', label: '收集规则', content: <CollectionSettings robotId={id} rag={rag} onChange={value => { setRag(value); if (value.mode === 'collector') setType('信息收集机器人'); else if (type === '信息收集机器人') setType('客服机器人'); }} /> },
{ id: 'collection-records', label: '收集记录', content: <CollectionRecords robotId={id} /> },
{ id: 'prompt', label: '问答提示词', content: <><section className="card rag-panel" style={{ marginBottom: 20 }}>
        <h2>提示词与业务规则</h2>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {(['primaryModelId', 'fallbackModelId', 'rerankModelId'] as const).map((key, i) => <div key={key}><span className="small">{['主模型', '备用模型', '重排模型'][i]}</span><div>{models.find(m => m.id === modelPolicy[key])?.name ?? (modelPolicy[key] ? '由平台管理' : '未配置')}</div></div>)}
        </div>
        <p className="small">当前租户的全部机器人使用相同模型，由平台统一配置。如需变更，请联系平台管理员。</p>
        <label>默认回答详略 <select className="select" value={rag.answerDetail ?? 'concise'} onChange={e => setRag({ ...rag, answerDetail: e.target.value as 'concise' | 'detailed' })}><option value="concise">简洁直接</option><option value="detailed">展开说明</option></select></label><p className="small">当前机器人的语气、业务规则与个性化表达由下方提示词决定；平台仅提供事实依据、权限和会话隔离规则。</p>
        <h3>客服表达设置</h3>
        <p className="small">仅作用于当前机器人，留空则沿用业务提示词。保存草稿后发布生效。表达设置不会扩大知识权限或修改人工回答。</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 16 }}>
          <label>客服性格<textarea className="input" style={{ width: '100%', boxSizing: 'border-box' }} rows={4} maxLength={2000} value={rag.personality ?? ''} onChange={e => setRag({ ...rag, personality: e.target.value })} placeholder="例如：耐心、可靠，遇到不确定的信息主动澄清，不夸大承诺。" /></label>
          <label>表达语气<textarea className="input" style={{ width: '100%', boxSizing: 'border-box' }} rows={4} maxLength={2000} value={rag.tone ?? ''} onChange={e => setRag({ ...rag, tone: e.target.value })} placeholder="例如：亲切自然，使用您，避免生硬术语，不使用表情符号。" /></label>
        </div>
        <label>回复格式<textarea className="input" style={{ width: '100%', boxSizing: 'border-box', marginBottom: 16 }} rows={4} maxLength={2000} value={rag.responseFormat ?? ''} onChange={e => setRag({ ...rag, responseFormat: e.target.value })} placeholder="例如：先用一句话直接回答；复杂问题再按步骤说明。不要复述问题，不加无关背景。" /></label>
        <p className="small">引用由系统校验和添加；严格原文模式保留原文。复杂格式须与所选回答详略相符。</p>
        <label htmlFor="robot-system-prompt">职责、业务范围与回答要求</label>
        <p id="prompt-help" className="small">可分段描述机器人职责、回答范围、引用要求和工具使用规则。保存草稿后发布生效。</p>
        <textarea id="robot-system-prompt" aria-describedby="prompt-help prompt-count" className="input" style={{ width: '100%', display: 'block', minHeight: 360, height: '42vh', resize: 'vertical', padding: 16, lineHeight: 1.75, fontFamily: 'inherit', boxSizing: 'border-box' }} rows={16} maxLength={12000} value={rag.systemPrompt ?? ''} onChange={e => setRag({ ...rag, systemPrompt: e.target.value })} placeholder="机器人职责：\n\n允许回答的业务范围：\n\n回答格式与来源要求：\n\n证据不足时的处理方式：" />
        <p id="prompt-count" className="small" style={{ textAlign: 'right' }}>{(rag.systemPrompt ?? '').length.toLocaleString()} / 12,000 字符 · 可拖动底边调整高度</p>
        </section></> },
{ id: 'retrieval', label: '知识检索', content: <><div className="card rag-panel">
          <div className="card-title" style={{ marginBottom: 4 }}>③ 知识库绑定 <span className="small muted">（候选池 — 实际检索范围按 人员/部门/密级 动态过滤）</span></div>
          {kbs.map((kb) => (
            <label key={kb.id} className="flex gap-3" style={{ gap: 8, padding: '10px 0', borderBottom: '1px dashed var(--border-light)', fontSize: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={selKbs.includes(kb.datasetId)} onChange={() => setSelKbs(toggle(selKbs, kb.datasetId))} style={{ accentColor: 'var(--primary)' }} />
              <span style={{ flex: 1, fontWeight: 500 }}>📚 {kb.name}</span>
              <span className="badge badge-neutral">{kb.visibility === 'restricted' ? '🔒 部门限定' : '🌐 全部部门'}</span>
            </label>
          ))}
          {kbs.length === 0 && <div className="small muted" style={{ padding: 12 }}>暂无知识库（先到知识库页上传文件）</div>}
          <Link to="/t/knowledge" className="link small" style={{ display: 'inline-block', marginTop: 8 }}>管理知识库 →</Link>

          <div style={{ marginTop: 14, border: '1px dashed var(--border)', borderRadius: 8, padding: 12, fontSize: 12, background: 'var(--bg-hover)' }}>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>同一机器人 · 不同人 → 不同回答</div>
            <div className="small muted">权限引擎每次请求计算白名单（角色∩部门∩密级）→ 注入 Dify 仅白名单内检索 → 响应切片二次校验</div>
          </div>
        </div><section className="card rag-panel"><h3>Wiki 范围</h3><p className="small">不勾选表示知识库范围内的全部 Wiki；勾选后仅包含选中的页面或目录及其后代。</p>{wikiPages.filter(p => p.status !== 'archived').map(p => <label key={p.id} style={{ marginRight: 12 }}><input type="checkbox" checked={rag.wikiRootIds?.includes(p.id) ?? false} onChange={e => setRag({ ...rag, wikiRootIds: e.target.checked ? [...(rag.wikiRootIds ?? []), p.id] : rag.wikiRootIds?.filter(id => id !== p.id) })} />{p.title}</label>)}
        <h3>检索与当前会话</h3><div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label>检索方式 <select className="select" value={rag.searchMethod ?? 'keyword_search'} onChange={e => setRag({ ...rag, searchMethod: e.target.value as NonNullable<Robot['ragConfig']>['searchMethod'] })}><option value="keyword_search">关键词</option><option value="semantic_search">语义</option><option value="hybrid_search">混合</option></select></label>
          <label>召回数 <input className="input" type="number" min={1} max={20} value={rag.topK ?? 5} onChange={e => setRag({ ...rag, topK: Number(e.target.value) })} /></label>
          <label>保留近期轮次 <input className="input" type="number" min={1} max={20} value={rag.historyTurns ?? 4} onChange={e => setRag({ ...rag, historyTurns: Number(e.target.value) })} /></label>
          <label>压缩触发比例 <input className="input" type="number" min={0.2} max={0.8} step={0.1} value={rag.compressionThreshold ?? 0.6} onChange={e => setRag({ ...rag, compressionThreshold: Number(e.target.value) })} /></label>
        </div><p>仅使用当前会话：超限优先摘要，再从当前会话历史选取相关片段。不会读取其他会话。</p>
      </section></> },
{ id: 'tools', label: '工具转人工', content: <><div className="card rag-panel">
          <div className="card-title" style={{ marginBottom: 12 }}>工具调用</div>
          <label><input type="checkbox" checked={rag.toolsEnabled ?? false} onChange={e => setRag({ ...rag, toolsEnabled: e.target.checked })} /> 允许使用已绑定的场景工具</label><p className="small">查询工具补齐参数后执行；提交工具收集信息并经客户确认后执行。每次调用均校验当前用户权限，关闭后不调用接口。</p>
          <label>工具调用场景（与机器人职责提示词共同保存）<textarea className="input" rows={8} style={{ width: '100%' }} value={rag.systemPrompt ?? ''} onChange={e => setRag({ ...rag, systemPrompt: e.target.value })} placeholder="只声明何时调用哪个工具。例如：客户询问订单进度时调用 order_query；客户申请售后时调用 ticket_create。入参、出参、补参规则和回复格式统一在外部接口工具中配置。" /></label>
          <p className="small">实际调用时自动组合机器人职责与表达设置、工具参数声明和工具回复约束。无需在此重复填写工具字段。</p>
          {tools.map((t) => (
            <label key={t.id} className="flex gap-3" style={{ gap: 8, padding: '8px 0', fontSize: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={selTools.includes(t.identifier)} onChange={() => setSelTools(toggle(selTools, t.identifier))} style={{ accentColor: 'var(--primary)' }} />
              {t.name} <span className="muted small">{t.identifier}</span>
            </label>
          ))}
          {tools.length === 0 && <div className="small muted">暂无工具（平台可为租户新增）</div>}
        </div><div className="card rag-panel">
          <div className="card-title" style={{ marginBottom: 12 }}>⑤ 转人工配置（知识未命中时）</div>
          <label className="flex gap-3" style={{ gap: 8, fontSize: 14, marginBottom: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={handoff} onChange={(e) => setHandoff(e.target.checked)} style={{ accentColor: 'var(--primary)' }} />
            知识未命中时 @群内客服
          </label>
          <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>兜底话术</div>
          <textarea className="input" rows={3} value={fallback} onChange={(e) => setFallback(e.target.value)} style={{ width: '100%', padding: 12, fontFamily: 'inherit' }} />
        </div></> },
{ id: 'usage', label: '用量统计', content: <><RobotTokenUsage robotId={id} /></> },
{ id: 'versions', label: '版本记录', content: <>      {!!robot?.configHistory?.length && <div className="card rag-panel" style={{ marginBottom: 16 }}><h2>已发布版本</h2>{robot.configHistory.slice().reverse().map(v => <p key={v.version}>版本 {v.version} · {new Date(v.publishedAt).toLocaleString()} <AsyncButton className="btn btn-secondary" disabled={busy} onClick={async () => { setBusy(true); try { const restored = await api<Robot>(`/api/v1/tenant/robots/${id}/restore-config`, { method: 'POST', body: JSON.stringify({ version: v.version }) }); setRobot(restored); setRag(restored.ragConfig ?? {}); setName(restored.name); setType(restored.type); setAppId(restored.difyAppId ?? ''); setWorkflowId(restored.workflowId ?? ''); setHandoff(restored.humanHandoff?.enabled ?? true); setFallback(restored.humanHandoff?.fallback ?? ''); setDesc(restored.description ?? ''); setSelKbs(restored.kbPool); setSelTools(restored.toolIdentifiers); setHandoff(restored.humanHandoff.enabled); setFallback(restored.humanHandoff.fallback); setMsg('已恢复为草稿，发布后生效'); } catch(e) { setMsg((e as Error).message); } finally { setBusy(false); } }}>恢复草稿</AsyncButton></p>)}</div>}
{!robot?.configHistory?.length && <p className="ui-empty">发布后将在这里保留配置版本。</p>}</> }]} />
    </>
  );
}
