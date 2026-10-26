import { useFeedback, Feedback, confirmAction, AsyncButton, ModalFrame } from '../components/Interaction';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { fmtDate } from '../api/datetime';
import ToolExecutionFields, { executionText } from '../components/ToolExecutionFields';

interface Tool {
  configRevision?: string;
  executionConfig?: Record<string, unknown>;
  id: string; name: string; description?: string; identifier: string; tenantId: string;
  url: string; method: string; authType?: 'API_KEY' | 'OAUTH2' | 'NONE'; apiKey?: string;
  requestSchema?: Record<string, unknown>; responseWhitelist?: string[]; allowedRoles?: string[];
  readOnly?: boolean; isActive: boolean; callCount?: number; successCount?: number; lastCalledAt?: string; createdAt: string;
}

const ROLE_OPTIONS = ['游客', '用户', '客服', '运营', '管理员', '员工'];

/** 状态三态（platform-tools.html）：草稿（未配置）→ 已发布（配置完整）→ 已禁用 */
const hasConfig = (t: Tool) => !!((t.readOnly && t.executionConfig?.mode === 'query') || (!t.readOnly && t.executionConfig?.mode === 'submit')) && !!t.responseWhitelist?.length;
const statusOf = (t: Tool) => {
  if (!t.isActive) return { label: '已禁用', cls: 'badge-warning', dot: '#F59E0B' };
  if (hasConfig(t)) return { label: '已发布', cls: 'badge-success', dot: '#10B981' };
  return { label: '草稿', cls: 'badge-neutral', dot: '#9CA3AF' };
};
const relTime = (iso?: string) => {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 172800_000) return '昨天';
  return fmtDate(iso);
};
const fmtJson = (v: unknown) => JSON.stringify(v ?? '', null, 2);

const emptyForm = () => ({
  configRevision: '',
  tenantId: '', name: '', description: '', identifier: '', url: '', method: 'POST',
  authType: 'API_KEY' as Tool['authType'], apiKey: '', roles: ['客服', '运营'],
  requestText: '{}', responseText: '[]', readOnly: false, executionText: '{}',
});
type Form = ReturnType<typeof emptyForm>;

/** 平台侧工具管理（对齐 platform-tools.html）：全租户总览 + Modal 新增/编辑（含租户选择） */
export default function PlatformTools() {
  const [rows, setRows] = useState<Tool[]>([]);
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);
  const [keyword, setKeyword] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [msg, setMsg] = useFeedback();
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(''); // '' = 新增
  const [saving, setSaving] = useState(false);
  const [jsonErr, setJsonErr] = useState('');
  const [testArgs, setTestArgs] = useState('{}');
  const [testResult, setTestResult] = useState('');
  const [form, setForm] = useState<Form>(emptyForm());

  const load = async () => setRows(await api<Tool[]>('/api/v1/admin/tools').then((d) => Array.isArray(d) ? d : (d as { list: Tool[] }).list ?? []).catch(() => []));
  useEffect(() => { load(); api<Array<{ id: string; name: string }>>('/api/v1/admin/tenants').then(setTenants).catch(() => {}); }, []);

  const tName = (id: string) => tenants.find((t) => t.id === id)?.name ?? id.slice(0, 8);
  const filtered = rows.filter((r) =>
    (!keyword || r.name.includes(keyword) || r.identifier.includes(keyword) || r.url.includes(keyword)) &&
    (!tenantFilter || r.tenantId === tenantFilter) &&
    (!statusFilter || statusOf(r).label === statusFilter));
  const st = (t: Tool) => statusOf(t);
  const rate = (t: Tool) => (t.callCount && t.callCount > 0 && t.successCount !== undefined ? `${Math.round((t.successCount / t.callCount) * 100)}%` : '—');
  // 调用成功率（全租户真实计数聚合，platform-tools.html 第 4 张概况卡）
  const totalCalls = rows.reduce((a, r) => a + (r.callCount ?? 0), 0);
  const totalSuccess = rows.reduce((a, r) => a + (r.successCount ?? 0), 0);

  const f = (k: keyof Form, v: string | string[]) => setForm({ ...form, [k]: v });
  const toggleRole = (r: string) => f('roles', form.roles.includes(r) ? form.roles.filter((x) => x !== r) : [...form.roles, r]);

  function openCreate() { setEditId(''); setJsonErr(''); setTestResult(''); setTestArgs('{}'); setForm(emptyForm()); setShowModal(true); }
  function openEdit(t: Tool) {
    setEditId(t.id); setJsonErr(''); setTestResult(''); setTestArgs('{}');
    setForm({
      tenantId: t.tenantId, name: t.name, description: t.description ?? '', identifier: t.identifier,
      url: t.url, method: t.method ?? 'POST', authType: t.authType ?? 'API_KEY', apiKey: t.apiKey ?? '',
      readOnly: t.readOnly ?? false, roles: t.allowedRoles?.length ? t.allowedRoles : ['客服', '运营'],
      requestText: fmtJson(t.requestSchema), responseText: fmtJson(t.responseWhitelist),
      configRevision: t.configRevision ?? '', executionText: executionText(t.executionConfig, t.readOnly),
    });
    setShowModal(true);
  }

  async function save() {
    if (!editId && !form.tenantId) { setJsonErr('⚠️ 请选择归属租户'); return; }
    if (!form.name.trim() || !form.identifier.trim() || !form.url.trim()) { setJsonErr('⚠️ 名称/标识/请求地址必填'); return; }
    if (form.roles.length === 0) { setJsonErr('⚠️ 至少选择一个访问角色'); return; }
    let requestSchema: Record<string, unknown> = {}, responseWhitelist: string[] = [];
    try {
      requestSchema = JSON.parse(form.requestText || '{}');
      const parsed = JSON.parse(form.responseText || '[]');
      if (!Array.isArray(parsed)) throw new Error('返回白名单须为 JSON 数组');
      responseWhitelist = parsed;
    } catch (e) { setJsonErr('⚠️ ' + (e as Error).message); return; }

    setSaving(true); setJsonErr('');
    const body = {
      name: form.name.trim(), description: form.description.trim() || undefined, identifier: form.identifier.trim(),
      method: form.method, url: form.url.trim(), authType: form.authType, apiKey: form.apiKey || undefined,
      requestSchema, responseWhitelist, allowedRoles: form.roles, readOnly: JSON.parse(form.executionText).mode === 'query', configRevision: form.configRevision || undefined, executionConfig: JSON.parse(form.executionText),
    };
    try {
      if (editId) {
        await api(`/api/v1/admin/tools/${editId}`, { method: 'PUT', body: JSON.stringify(body) });
        setMsg(`✅ 已更新「${body.name}」（归属 ${tName(form.tenantId)}）`);
      } else {
        await api('/api/v1/admin/tools', { method: 'POST', body: JSON.stringify({ ...body, tenantId: form.tenantId }) });
        setMsg(`✅ 已为「${tName(form.tenantId)}」新增工具「${body.name}」，租户侧外部接口即时可见`);
      }
      setShowModal(false); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); } finally { setSaving(false); }
  }

  async function remove(t: Tool) {
    if (!(await confirmAction(`确认删除工具「${t.name}」（归属 ${tName(t.tenantId)}）？删除后机器人将无法调用，不可恢复`, { confirmText: '确认删除' }))) return;
    try {
      await api(`/api/v1/admin/tools/${t.id}`, { method: 'DELETE', body: JSON.stringify({ verify: { positive: true, negative: true } }) });
      setMsg(`✅ 已删除「${t.name}」`); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>工具管理（全租户）</h1>
          <div className="desc">查看所有租户的外部接口工具（Tool Gateway 统一管控）· 支持平台侧为租户新增工具</div>
        </div>
        <AsyncButton className="btn btn-primary" onClick={openCreate}>+ 新增工具（为租户）</AsyncButton>
      </div>

      {msg && <Feedback message={msg} />}

      {/* 概况卡 */}
      <div className="metrics" style={{ marginBottom: 14 }}>
        <div className="metric"><div className="m-label">工具总数</div><div className="m-value">{rows.length}</div><div className="m-sub">全租户</div></div>
        <div className="metric"><div className="m-label">已发布</div><div className="m-value">{rows.filter((r) => statusOf(r).label === '已发布').length}</div><div className="m-sub">配置完整可用</div></div>
        <div className="metric"><div className="m-label">草稿</div><div className="m-value">{rows.filter((r) => statusOf(r).label === '草稿').length}</div><div className="m-sub">待完善配置</div></div>
        <div className="metric"><div className="m-label">调用成功率</div><div className="m-value">{totalCalls > 0 ? `${Math.round((totalSuccess / totalCalls) * 1000) / 10}%` : '—'}</div><div className="m-sub">全租户累计 {totalCalls} 次调用</div></div>
      </div>

      {/* 筛选 */}
      <div className="flex gap-3" style={{ marginBottom: 12 }}>
        <input className="input" style={{ width: 200 }} placeholder="搜索工具/标识/目标系统…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">全部状态</option>
          <option>已发布</option>
          <option>草稿</option>
          <option>已禁用</option>
        </select>
        <select className="select" value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}>
          <option value="">全部租户</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span className="small muted" style={{ alignSelf: 'center' }}>{filtered.length} 个</span>
      </div>

      {/* 工具列表（platform-tools.html 10 列） */}
      <div className="card">
        <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
          <thead><tr><th>工具名称</th><th>标识</th><th>所属租户</th><th>用途</th><th>目标系统</th><th>认证</th><th>状态</th><th>最近调用</th><th>成功率</th><th>操作</th></tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{r.name}</td>
                <td className="muted small" style={{ fontFamily: 'monospace' }}>{r.identifier}</td>
                <td><span className="badge badge-info">{tName(r.tenantId)}</span></td>
                <td className="muted small" style={{ maxWidth: 130 }}>{r.description || '—'}</td>
                <td className="muted small" style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.url}>{r.url}</td>
                <td><span className="badge badge-neutral">{r.authType === 'NONE' ? '无认证' : r.authType === 'OAUTH2' ? 'OAuth2' : 'API Key'}</span></td>
                <td><span className={`badge ${st(r).cls}`}><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: st(r).dot, marginRight: 5, verticalAlign: 'middle' }} />{st(r).label}</span></td>
                <td className="muted small">{relTime(r.lastCalledAt)}</td>
                <td><span className="small" style={{ color: rate(r) === '—' ? 'var(--text-muted)' : 'var(--success-text)' }}>{rate(r)}</span></td>
                <td className="cell-actions">
                  <AsyncButton className="link" onClick={() => openEdit(r)}>编辑</AsyncButton>
                  <AsyncButton className="link danger" onClick={() => remove(r)}>删除</AsyncButton>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 24 }}>暂无工具</td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="ai-warning info mt-4">
        <span className="ic">📌</span>
        <div>工具经 Tool Gateway 统一管控（四道关：RBAC 鉴权 → 参数白名单 → 限流 → 认证注入）；平台侧新增工具后自动归属指定租户，租户侧「外部接口」列表即时可见并可绑定机器人；工具调用全程审计（平台审计可查全租户工具调用）。</div>
      </div>

      {/* 新增/编辑 Modal（对齐 platform-tools.html：modal-mask/modal + form-row/form-item + group-item） */}
      {showModal && (
        <ModalFrame title={editId ? '编辑工具' : '新增工具'} onClose={() => { setShowModal(false); }} drawer>
          <div className="modal wide">
            <div className="m-head"><h3>{editId ? `编辑工具 — ${form.name}` : '新增工具（为租户）'}</h3><AsyncButton closeDialog className="x" onClick={() => setShowModal(false)}>✕</AsyncButton></div>
            <div className="m-body">
              <div className="form-row">
                <div className="form-item"><label>适用租户 *（单选 · 平台侧指定）</label>
                  <select className="select" value={form.tenantId} onChange={(e) => f('tenantId', e.target.value)} disabled={!!editId}>
                    {editId ? <option value={form.tenantId}>{tName(form.tenantId)}（不可改）</option> : <option value="">选择租户…</option>}
                    {!editId && tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="form-item"><label>工具名称 *</label><input className="input" placeholder="如：库存查询" value={form.name} onChange={(e) => f('name', e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div className="form-item"><label>标识 *（供 Dify 引用）</label><input className="input" placeholder="stock_query" value={form.identifier} onChange={(e) => f('identifier', e.target.value)} disabled={!!editId} /></div>
                <div className="form-item"><label>用途</label><input className="input" placeholder="如 查询订单状态/金额" value={form.description} onChange={(e) => f('description', e.target.value)} /></div>
              </div>
              <div className="form-row">
                <div className="form-item"><label>请求方法 *</label>
                  <select className="select" value={form.method} onChange={(e) => f('method', e.target.value)}>
                    <option>POST</option><option>GET</option><option>PUT</option>
                  </select>
                </div>
                <div className="form-item"><label>请求地址 *</label><input className="input" placeholder="https://api.xxx.com/v1/query" value={form.url} onChange={(e) => f('url', e.target.value)} /></div>
              </div>
              <ToolExecutionFields value={form.executionText} onChange={value => f('executionText', value)} />
              <div className="form-row">
                <div className="form-item"><label>认证方式</label>
                  <select className="select" value={form.authType} onChange={(e) => f('authType', e.target.value)}>
                    <option value="API_KEY">API Key（Header）</option><option value="OAUTH2">OAuth2</option><option value="NONE">无认证</option>
                  </select>
                </div>
                {form.authType !== 'NONE' && <div className="form-item"><label>API Key / Token</label><input className="input" type="password" placeholder="认证注入用" value={form.apiKey} onChange={(e) => f('apiKey', e.target.value)} /></div>}
              </div>
              <div className="form-item">
                <label>请求参数（传值 JSON Schema，Gateway 白名单校验）</label>
                <textarea className="input mono" rows={3} value={form.requestText} onChange={(e) => f('requestText', e.target.value)} placeholder={'{\n  "order_id": {"type": "string", "required": true}\n}'} />
              </div>
              <div className="form-item">
                <label>返回字段白名单（输出，仅回传这些字段）</label>
                <textarea className="input mono" rows={2} value={form.responseText} onChange={(e) => f('responseText', e.target.value)} placeholder='["id", "status"]' />
              </div>
              <div className="form-item">
                <label>访问角色（谁可调用）</label>
                {ROLE_OPTIONS.map((r) => (
                  <label key={r} className={`group-item chk-inline ${form.roles.includes(r) ? 'sel' : ''}`}>
                    <input type="checkbox" checked={form.roles.includes(r)} onChange={() => toggleRole(r)} />{r}
                  </label>
                ))}
              </div>
              {jsonErr && <div className="small" style={{ color: 'var(--error)', marginBottom: 8 }}>{jsonErr}</div>}
              {editId && <div className="form-item"><label>测试已保存配置（修改后请先保存并重新打开）<textarea className="input mono" rows={3} value={testArgs} onChange={e => setTestArgs(e.target.value)} /></label><AsyncButton className="btn btn-secondary" onClick={async () => {
                setTestResult('');
                try { const result = await api<{ message: string; data: unknown }>(`/api/v1/admin/tools/${editId}/test`, { method: 'POST', body: JSON.stringify({ arguments: JSON.parse(testArgs) }) }); setTestResult(result.message + (result.data ? '\n' + JSON.stringify(result.data, null, 2) : '')); }
                catch (error) { setTestResult('测试失败：' + (error as Error).message); }
              }}>运行测试</AsyncButton>{testResult && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} role="status">{testResult}</pre>}</div>}
              <div className="ai-warning info">
                <span className="ic">📌</span>
                <div>平台新增后自动归属所选租户，租户侧「外部接口」即时可见并可绑定机器人；建议同时告知租户管理员完成联调测试。</div>
              </div>
            </div>
            <div className="m-foot">
              <AsyncButton closeDialog className="btn btn-secondary" onClick={() => setShowModal(false)}>取消</AsyncButton>
              <AsyncButton className="btn btn-primary" disabled={saving} onClick={save}>{saving ? '保存中…' : '保存工具'}</AsyncButton>
            </div>
          </div>
        </ModalFrame>
      )}
    </>
  );
}
