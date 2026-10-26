import { useFeedback, Tabs, Feedback, AsyncButton, ModalFrame } from '../components/Interaction';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { DifyApp } from '../api/client';

interface AssignedRow { resourceId: string; tenantId: string; dsKey?: string; bindRobotId?: string; createdAt?: string }

/** Dify 资源管理（FR-022）：同步资源池 → 分配（可绑定机器人）→ ds-key 冒烟（真实联调 Dify 1.9） */
export default function DifyResources() {
  const [apps, setApps] = useState<DifyApp[]>([]);
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);
  const [assignApp, setAssignApp] = useState<DifyApp | null>(null);
  const [assignAppLocked, setAssignAppLocked] = useState(false); // 行内入口锁定资源；页头入口可切换资源
  const [assignTenant, setAssignTenant] = useState('');
  const [assignDataset, setAssignDataset] = useState('');
  const [assignRobotId, setAssignRobotId] = useState('');
  const [tenantRobots, setTenantRobots] = useState<Array<{ id: string; name: string }>>([]);
  const [msg, setMsg] = useFeedback();
  const [syncing, setSyncing] = useState(false);
  // 已分配资源（全平台，含租户/dsKey/绑定机器人）
  const [assigned, setAssigned] = useState<AssignedRow[]>([]);
  // 各租户机器人名映射（绑定机器人列展示用）
  const [robotsMap, setRobotsMap] = useState<Record<string, Array<{ id: string; name: string }>>>({});
  // 密钥查看（dify-resources.html 行内「密钥」）
  const [keyView, setKeyView] = useState<AssignedRow | null>(null);
  // App 对话测试（选择/填写 App ID → 调用对应 App 的 chat-messages）
  const [testAppId, setTestAppId] = useState('');
  const [testKey, setTestKey] = useState('');
  const [testQuery, setTestQuery] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api<Array<{ id: string; name: string }>>('/api/v1/admin/tenants').then(setTenants).catch(() => {});
    loadAssigned();
  }, []);

  async function loadAssigned() {
    const list = await api<AssignedRow[]>('/api/v1/admin/dify/resources').catch(() => []);
    setAssigned(list);
    // 拉取涉及租户的机器人列表（绑定机器人列显示机器人名）
    const tids = [...new Set(list.map((x) => x.tenantId).filter(Boolean))];
    const maps = await Promise.all(tids.map(async (tid) => [
      tid,
      await api<Array<{ id: string; name: string }>>(`/api/v1/admin/dify/robots?tenantId=${tid}`).catch(() => [] as Array<{ id: string; name: string }>),
    ] as const));
    setRobotsMap(Object.fromEntries(maps));
  }

  // 分配 Modal：切换租户时加载该租户机器人（绑定机器人下拉数据源）
  useEffect(() => {
    if (!assignTenant) { setTenantRobots([]); return; }
    api<Array<{ id: string; name: string }>>(`/api/v1/admin/dify/robots?tenantId=${assignTenant}`)
      .then(setTenantRobots).catch(() => setTenantRobots([]));
  }, [assignTenant]);

  async function assign() {
    if (!assignApp || !assignTenant) return;
    try {
      const r = await api<{ dsKey?: string }>('/api/v1/admin/dify/resources/assign', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: assignTenant, resourceId: assignApp.id,
          resourceType: assignApp.mode === 'workflow' ? 'workflow' : 'app', resourceName: assignApp.name,
          bindRobotId: assignRobotId || undefined, datasetId: assignDataset.trim() || undefined,
        }),
      });
      setMsg(`✅ 已分配「${assignApp.name}」给「${tenants.find((t) => t.id === assignTenant)?.name}」${assignRobotId ? '并绑定机器人' : ''}${r.dsKey ? '（ds-key 已安全创建）' : ''}`);
      setAssignApp(null);
      loadAssigned();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function sync() {
    setSyncing(true); setMsg('');
    try {
      const res = await api<{ total: number; apps: DifyApp[] }>(
        '/api/v1/admin/dify/resources/sync',
      );
      setApps(res.apps ?? []);
      setMsg(`✅ 已从 Dify 同步 ${res.total} 个 App 资源`);
    } catch (e) {
      setMsg('❌ ' + (e as Error).message + '（需在 Dify 控制台配置管理员 Key）');
    } finally {
      setSyncing(false);
    }
  }

  /** 页头「+ 分配资源」：打开 Modal 并预选首个未分配资源 */
  function openAssignAny() {
    if (apps.length === 0) { setMsg('⚠️ 资源池为空，请先「同步 Dify 资源」'); return; }
    const free = apps.find((a) => !assigned.find((x) => x.resourceId === a.id)) ?? apps[0];
    setAssignAppLocked(false);
    setAssignApp(free);
    setAssignRobotId('');
    setAssignTenant(tenants[0]?.id ?? '');
  }

  const robotName = (row: AssignedRow) =>
    row.bindRobotId ? (robotsMap[row.tenantId]?.find((r) => r.id === row.bindRobotId)?.name ?? row.bindRobotId.slice(0, 8)) : '';

  /** 选择下拉 App → 回填 ID 输入（可再手改）；也支持直接手填任意 App ID */
  function pickApp(id: string) { setTestAppId(id); }

  /** 测试对话：调 POST /apps/:appId/run（chat-messages）调用对应 App */
  async function runTest() {
    if (!testAppId.trim()) { setTestResult({ ok: false, text: '请先选择或填写 App ID' }); return; }
    if (!testQuery.trim()) { setTestResult({ ok: false, text: '请输入要测试的问题' }); return; }
    if (!testKey.trim()) { setTestResult({ ok: false, text: '请填写该 App 的 API Key（App → API 访问）' }); return; }
    setTesting(true); setTestResult(null);
    const t0 = Date.now();
    try {
      const r = await api<{ answer: string; conversation_id?: string }>(`/api/v1/admin/dify/apps/${encodeURIComponent(testAppId.trim())}/run`, {
        method: 'POST',
        body: JSON.stringify({ apiKey: testKey, query: testQuery }),
      });
      setTestResult({ ok: true, text: `（${Date.now() - t0}ms）${r.answer ?? '无返回'}` });
    } catch (e) { setTestResult({ ok: false, text: '❌ ' + (e as Error).message }); }
    finally { setTesting(false); }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dify 资源管理</h1>
          <div className="desc">App/Workflow 资源池 → 按租户分配 → ds-key 自动创建（架构 A1）</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <AsyncButton className="btn btn-secondary" onClick={openAssignAny}>+ 分配资源</AsyncButton>
          <AsyncButton className="btn btn-primary" onClick={sync} disabled={syncing}>
            {syncing ? '同步中…' : '⟳ 同步 Dify 资源'}
          </AsyncButton>
        </div>
      </div>

      {msg && <Feedback message={msg} />}

      <Tabs items={[{ id: 'resources', label: '资源分配', content: <div className="card">
        {/* 概况卡（对齐原型 dify-resources.html） */}
        <div className="metrics" style={{ marginBottom: 14 }}>
          <div className="metric"><div className="m-label">Dify 实例</div><div className="m-value" style={{ fontSize: 20 }}>1.9.0 ✅</div><div className="m-sub">localhost:5001 · 已连通</div></div>
          <div className="metric"><div className="m-label">资源总数</div><div className="m-value">{apps.length}</div><div className="m-sub">同步资源池</div></div>
          <div className="metric"><div className="m-label">已分配</div><div className="m-value">{assigned.length}</div><div className="m-sub">绑定租户</div></div>
          <div className="metric"><div className="m-label">未分配</div><div className="m-value">{Math.max(0, apps.length - assigned.length)}</div><div className="m-sub">待分配</div></div>
        </div>

        <div className="card-title" style={{ marginBottom: 8 }}>资源池（{apps.length}）</div>
        <div className="card-sub" style={{ marginBottom: 16 }}>
          Dify 实例与管理凭据由「平台设置」统一加密保管，本页不在浏览器保存密钥。
        </div>
        <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
          <thead>
            <tr><th>资源名称</th><th>类型</th><th>App ID</th><th>ds-key</th><th>分配给租户</th><th>绑定机器人</th><th>操作</th></tr>
          </thead>
          <tbody>
            {apps.map((a) => {
              const aInfo = assigned.find((x) => x.resourceId === a.id);
              return (
                <tr key={a.id}>
                  <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{a.name}</td>
                  <td>{a.mode === 'workflow' ? <span className="badge badge-neutral">Workflow</span> : <span className="badge badge-info">App</span>}</td>
                  <td className="muted small">{a.id}</td>
                  <td>{aInfo?.dsKey ? <span className="badge badge-success">已创建</span> : <span className="muted small">未创建</span>}</td>
                  <td>{aInfo ? <span className="badge badge-info">{tenants.find((t) => t.id === aInfo.tenantId)?.name ?? aInfo.tenantId.slice(0, 8)}</span> : <span className="muted">未分配</span>}</td>
                  <td>{aInfo?.bindRobotId ? <span className="badge badge-neutral">{robotName(aInfo)}</span> : <span className="muted small">—</span>}</td>
                  <td>
                    <AsyncButton className="link" onClick={() => { setAssignApp(a); setAssignAppLocked(true); setAssignTenant(aInfo?.tenantId ?? tenants[0]?.id ?? ''); setAssignRobotId(aInfo?.bindRobotId ?? ''); }}>{aInfo ? '改分配' : '分配租户'}</AsyncButton>
                    {aInfo?.dsKey && <AsyncButton className="link" style={{ marginLeft: 10 }} onClick={() => setKeyView(aInfo)}>密钥</AsyncButton>}
                  </td>
                </tr>
              );
            })}
            {apps.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 32 }}>
                点击「同步 Dify 资源」拉取（真实数据）
              </td></tr>
            )}
          </tbody>
        </table></div>
      </div> }, { id: 'test', label: '对话测试', content: <div className="card mt-4">
        <div className="card-title" style={{ marginBottom: 8 }}>🧪 App 对话测试（选择/填写 App ID → 调用对应 App）</div>
        <div className="small muted" style={{ marginBottom: 12 }}>验证 Dify App 真实应答链路：下拉选择同步资源（可改）或直接手填任意 App ID · 走服务端 chat-messages</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <div className="small" style={{ marginBottom: 4, color: 'var(--text-primary)', fontWeight: 500 }}>选择 App（同步后可选）</div>
            <select className="select" style={{ width: '100%' }} value={apps.some((a) => a.id === testAppId) ? testAppId : ''} onChange={(e) => pickApp(e.target.value)}>
              <option value="">选择资源池 App…</option>
              {apps.map((a) => <option key={a.id} value={a.id}>{a.name}（{a.id.slice(0, 8)}…）</option>)}
            </select>
          </div>
          <div>
            <div className="small" style={{ marginBottom: 4, color: 'var(--text-primary)', fontWeight: 500 }}>App ID（选择后回填，可手改/手填）</div>
            <input className="input" style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }} placeholder="如 1234abcd-…（Dify 控制台 App 地址栏 ID）" value={testAppId} onChange={(e) => setTestAppId(e.target.value)} />
          </div>
        </div>
        <input
          className="input"
          style={{ width: '100%', marginBottom: 10 }}
          type="password"
          placeholder="App API Key（控制台 → App → API 访问 → API 密钥，自动记忆）"
          value={testKey}
          onChange={(e) => setTestKey(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <input className="input" style={{ flex: 1 }} placeholder="输入测试问题（如：你好，介绍一下自己）" value={testQuery}
            onChange={(e) => setTestQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && runTest()} />
          <AsyncButton className="btn btn-primary" disabled={testing} onClick={runTest}>{testing ? '调用中…' : '发送'}</AsyncButton>
        </div>
        {testResult && (
          <div className="small" style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, whiteSpace: 'pre-wrap', background: testResult.ok ? 'var(--success-bg)' : 'var(--error-bg)', color: testResult.ok ? 'var(--success-text)' : 'var(--error-text)' }}>
            {testResult.ok ? '🤖 ' : ''}{testResult.text}
          </div>
        )}
      </div> }]} />

      {/* 分配 Modal */}
      {assignApp && (
        <ModalFrame title="分配资源" onClose={() => { setAssignApp(null); }}>
          <div className="card" style={{ width: 440, maxWidth: '94vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="card-title">分配资源{assignAppLocked ? ` — ${assignApp.name}` : ''}</div>
              <AsyncButton closeDialog style={{ cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)' }} onClick={() => setAssignApp(null)}>✕</AsyncButton>
            </div>
            {!assignAppLocked && (
              <>
                <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>选择资源</div>
                <select className="select" style={{ width: '100%', marginBottom: 14 }} value={assignApp.id} onChange={(e) => setAssignApp(apps.find((a) => a.id === e.target.value) ?? null)}>
                  {apps.map((a) => <option key={a.id} value={a.id}>{a.name}（{a.mode === 'workflow' ? 'Workflow' : 'App'}{assigned.find((x) => x.resourceId === a.id) ? ' · 已分配' : ''}）</option>)}
                </select>
              </>
            )}
            <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>分配给租户</div>
            <select className="select" style={{ width: '100%', marginBottom: 14 }} value={assignTenant} onChange={(e) => { setAssignTenant(e.target.value); setAssignRobotId(''); }}>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>绑定机器人（可选）</div>
            <select className="select" style={{ width: '100%', marginBottom: 14 }} value={assignRobotId} onChange={(e) => setAssignRobotId(e.target.value)}>
              <option value="">暂不绑定</option>
              {tenantRobots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <label className="small">知识库 ID（新绑定证据流程时必填）<input className="input" style={{ width: '100%', marginBottom: 14 }} value={assignDataset} onChange={e => setAssignDataset(e.target.value)} placeholder="Dify Dataset ID" /></label>
            <p className="small muted">绑定后立即更新指定机器人的证据流程或 Agent，保留机器人提示词和当前会话记忆。Agent 须返回约定的原文证据 JSON；最终回答遵循租户机器人提示词。</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <AsyncButton closeDialog className="btn btn-secondary" onClick={() => setAssignApp(null)}>取消</AsyncButton>
              <AsyncButton className="btn btn-primary" onClick={assign}>确认分配</AsyncButton>
            </div>
          </div>
        </ModalFrame>
      )}

      {/* 密钥查看 Modal（ds-key 全文 + 归属信息） */}
      {keyView && (
        <ModalFrame title="资源密钥" onClose={() => { setKeyView(null); }}>
          <div className="card" style={{ width: 480, maxWidth: '94vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="card-title">资源密钥</div>
              <AsyncButton closeDialog style={{ cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)' }} onClick={() => setKeyView(null)}>✕</AsyncButton>
            </div>
            <div className="small muted" style={{ marginBottom: 6 }}>资源：{apps.find((a) => a.id === keyView.resourceId)?.name ?? keyView.resourceId.slice(0, 8)} · 租户：{tenants.find((t) => t.id === keyView.tenantId)?.name ?? keyView.tenantId.slice(0, 8)}</div>
            <div className="small muted" style={{ marginBottom: 6 }}>ds-key（分配时自动创建，网关白名单检索用）：</div>
            <div style={{ fontSize: 12, background: 'var(--bg-secondary, #F3F4F6)', padding: 10, borderRadius: 6 }}>密钥已加密保存，不支持回显。机器人检索时仅在服务端内存中解密使用。</div>
            {keyView.createdAt && <div className="small muted" style={{ marginTop: 8 }}>创建时间：{String(keyView.createdAt).slice(0, 19).replace('T', ' ')}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <AsyncButton closeDialog className="btn btn-secondary" onClick={() => setKeyView(null)}>关闭</AsyncButton>
            </div>
          </div>
        </ModalFrame>
      )}
    </>
  );
}
