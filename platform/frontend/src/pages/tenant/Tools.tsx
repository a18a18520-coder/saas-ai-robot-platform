import { useFeedback, PageData, Feedback, confirmAction, AsyncButton, ModalFrame, notify } from '../../components/Interaction';
import { useEffect, useState } from 'react';
import { api, CURRENT_TENANT_ID } from '../../api/client';
import { fmtDate } from '../../api/datetime';
import ToolExecutionFields, { executionText } from '../../components/ToolExecutionFields';

const TID = CURRENT_TENANT_ID;

interface Tool {
  configRevision?: string;
  readOnly?: boolean;
  executionConfig?: Record<string, unknown>;
  id: string;
  name: string;
  description?: string;
  identifier: string;
  url: string;
  method: string;
  authType?: 'API_KEY' | 'OAUTH2' | 'NONE';
  apiKey?: string;
  /** 请求参数 JSON Schema（传值配置） */
  requestSchema?: Record<string, unknown>;
  /** 返回字段白名单（输出配置） */
  responseWhitelist?: string[];
  allowedRoles?: string[];
  isActive: boolean;
  callCount?: number;
  successCount?: number;
  lastCalledAt?: string;
  createdAt: string;
}

/** 身份选项（对齐 User.identity / tool-config ④） */
const ROLE_OPTIONS = ['游客', '用户', '客服', '运营', '管理员', '员工'];

/** 角色标签类（原型 perm-tag：internal 蓝 / admin 红 / external 灰） */
const roleCls = (r: string) => r === '管理员' ? 'perm-tag perm-admin' : (r === '客服' || r === '运营') ? 'perm-tag perm-internal' : 'perm-tag perm-external';

/** 最近调用相对时间（tools.html「最近调用」列） */
function relTime(iso?: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 172800_000) return '昨天';
  return fmtDate(iso);
}

/** 状态三态（tools.html）：草稿（未配置）→ 已发布（配置完整）→ 已禁用 */
function statusOf(t: Tool): { label: string; cls: string; dot: string } {
  if (!t.isActive) return { label: '已禁用', cls: 'badge-warning', dot: '#F59E0B' };
  if (hasConfig(t)) return { label: '已发布', cls: 'badge-success', dot: '#10B981' };
  return { label: '草稿', cls: 'badge-neutral', dot: '#9CA3AF' };
}
function hasConfig(t: Tool) {
  return !!((t.readOnly && t.executionConfig?.mode === 'query') || (!t.readOnly && t.executionConfig?.mode === 'submit')) && !!t.responseWhitelist?.length;
}
const fmtJson = (v: unknown) => JSON.stringify(v ?? '', null, 2);

/** 空表单（新建/重置） */
const emptyForm = () => ({
  configRevision: '',
  name: '', description: '', identifier: '', url: '', method: 'POST',
  authType: 'API_KEY' as Tool['authType'], apiKey: '', roles: ['客服', '运营'],
  requestText: '{}', responseText: '[]', executionText: '{}',
});
type CfgForm = ReturnType<typeof emptyForm>;

export default function Tools() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [msg, setMsg] = useFeedback();
  // 新建/配置 Modal（对齐 tool-config 弹窗：create=完整配置新建；edit=编辑配置含测试调用）
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CfgForm>(emptyForm());
  const [jsonErr, setJsonErr] = useState('');
  // 测试调用（tool-config ⑤：参数白名单校验）
  const [testArgs, setTestArgs] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [pageLoad, setPageLoad] = useState({ loading: true, ready: false, error: '' });
  async function load() {
    setPageLoad(old => ({ ...old, loading: true, error: '' }));
    try { setTools(await api<Tool[]>(`/api/v1/tenant/tools?tenantId=${TID}`));
      setPageLoad({ loading: false, ready: true, error: '' });
    } catch (cause) { setPageLoad(old => ({ ...old, loading: false, error: (cause as Error).message })); }
  }
  useEffect(() => { load().catch(() => {}); }, []);

  const f = (k: keyof CfgForm, v: string | string[]) => setForm({ ...form, [k]: v });
  const toggleRole = (roles: string[], r: string) => roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r];
  const parseJson = (input: { requestText: string; responseText: string }): { schema: Record<string, unknown>; whitelist: string[] } | null => {
    try {
      const schema = JSON.parse(input.requestText ?? '{}');
      const whitelist = JSON.parse(input.responseText ?? '[]');
      if (!Array.isArray(whitelist)) throw new Error('返回白名单须为 JSON 数组');
      return { schema, whitelist };
    } catch (e) { setJsonErr('⚠️ ' + (e as Error).message); return null; }
  };

  /** 创建工具（完整配置一次提交，对齐 tool-config：保存即发布） */
  async function create() {
    if (!form.name.trim() || !form.identifier.trim() || !form.url.trim()) { setJsonErr('⚠️ 名称/标识/目标 URL 必填'); return; }
    const parsed = parseJson(form);
    if (!parsed) return;
    if (form.roles.length === 0) { setJsonErr('⚠️ 至少选择一个访问角色'); return; }
    setJsonErr(''); setSaving(true);
    try {
      await api('/api/v1/tenant/tools', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: TID, name: form.name.trim(), description: form.description.trim() || undefined,
          identifier: form.identifier.trim(), method: form.method, url: form.url.trim(),
          authType: form.authType, apiKey: form.apiKey || undefined,
          requestSchema: parsed.schema, responseWhitelist: parsed.whitelist, allowedRoles: form.roles,
          configRevision: form.configRevision || undefined, executionConfig: JSON.parse(form.executionText), readOnly: JSON.parse(form.executionText).mode === 'query',
        }),
      });
      setMsg(`✅ 工具「${form.name}」已创建并发布（传值 ${Object.keys(parsed.schema).length} 参数 · 输出白名单 ${parsed.whitelist.length} 字段）`);
      setModal(null); setForm(emptyForm()); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); } finally { setSaving(false); }
  }

  /** 打开配置 Modal（tool-config 编辑模式，回填表单） */
  async function openConfig(t: Tool) {
    setJsonErr(''); setTestResult(null); setTestArgs('');
    const d = await api<Tool>(`/api/v1/tenant/tools/${t.id}`);
    setForm({
      name: d.name, description: d.description ?? '', identifier: d.identifier, url: d.url, method: d.method ?? 'POST',
      authType: d.authType ?? 'API_KEY', apiKey: d.apiKey ?? '', roles: d.allowedRoles?.length ? d.allowedRoles : ['客服', '运营'],
      requestText: fmtJson(d.requestSchema), responseText: fmtJson(d.responseWhitelist),
      configRevision: d.configRevision ?? '', executionText: executionText(d.executionConfig, d.readOnly),
    });
    // 测试参数默认示例：取必填首个字段生成
    const schema = d.requestSchema as Record<string, { type?: string }> | undefined;
    const sample: Record<string, string> = {};
    if (schema) {
      for (const [k, v] of Object.entries(schema)) {
        if (v?.type) sample[k] = v.type === 'number' ? '1' : v.type === 'integer' ? '1' : '示例值';
        if ((v as { required?: boolean }).required) break;
      }
    }
    setTestArgs(JSON.stringify(sample, null, 2));
    setModal({ mode: 'edit', id: t.id });
  }

  /** 保存配置（编辑态 PUT） */
  async function saveConfig() {
    const parsed = parseJson(form);
    if (!parsed) return;
    if (form.roles.length === 0) { setJsonErr('⚠️ 至少选择一个访问角色'); return; }
    setJsonErr(''); setSaving(true);
    const id = modal?.mode === 'edit' ? modal.id : '';
    try {
      await api(`/api/v1/tenant/tools/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: form.name.trim(), description: form.description.trim() || undefined, method: form.method, url: form.url.trim(),
          authType: form.authType, apiKey: form.apiKey || undefined,
          requestSchema: parsed.schema, responseWhitelist: parsed.whitelist, allowedRoles: form.roles,
          configRevision: form.configRevision || undefined, executionConfig: JSON.parse(form.executionText), readOnly: JSON.parse(form.executionText).mode === 'query',
        }),
      });
      setMsg(`✅ 「${form.name}」配置已保存并发布（传值 ${Object.keys(parsed.schema).length} 参数 · 输出白名单 ${parsed.whitelist.length} 字段）`);
      setModal(null); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); } finally { setSaving(false); }
  }

  async function runTest() {
    if (modal?.mode !== 'edit') return;
    try {
      const args = JSON.parse(testArgs || '{}');
      const result = await api<{ message: string; data: unknown }>(`/api/v1/tenant/tools/${modal.id}/test`, { method: 'POST', body: JSON.stringify({ arguments: args }) });
      setTestResult({ ok: true, text: result.message + (result.data ? '\n' + JSON.stringify(result.data, null, 2) : '') });
    } catch (e) { setTestResult({ ok: false, text: (e as Error).message }); }
  }

  async function toggle(t: Tool) {
    if (!(await confirmAction(`确认${t.isActive ? '禁用' : '启用'}工具「${t.name}」？（正反向验证：${t.isActive ? '禁用后机器人将无法调用此接口' : '恢复机器人调用能力'}）`, { confirmText: t.isActive ? '禁用工具' : '启用工具' }))) return;
    try {
      await api(`/api/v1/tenant/tools/${t.id}/${t.isActive ? 'disable' : 'enable'}`, { method: 'POST', body: JSON.stringify({ verify: { positive: true, negative: true } }) });
      setMsg(t.isActive ? `✅ 已禁用「${t.name}」` : `✅ 已启用「${t.name}」`); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function remove(t: Tool) {
    if (!(await confirmAction(`确认删除工具「${t.name}」？删除后机器人将无法调用（不可恢复）`, { confirmText: '确认删除' }))) return;
    try {
      await api(`/api/v1/tenant/tools/${t.id}`, { method: 'DELETE', body: JSON.stringify({ verify: { positive: true, negative: true } }) });
      setMsg(`✅ 已删除「${t.name}」`); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  const st = (t: Tool) => statusOf(t);
  const rate = (t: Tool) => (t.callCount && t.callCount > 0 && t.successCount !== undefined ? `${Math.round((t.successCount / t.callCount) * 100)}%` : '—');

  return (
    <><PageData state={pageLoad} onRetry={load}>
      <div className="page-header">
        <div>
          <h1>外部接口</h1>
          <div className="desc">AI 调用外部业务系统的安全网关（Tool Gateway）· 全部经鉴权与审计</div>
        </div>
        <AsyncButton className="btn btn-primary" onClick={() => { setJsonErr(''); setTestResult(null); setForm(emptyForm()); setModal({ mode: 'create' }); }}>+ 新建工具</AsyncButton>
      </div>

      {/* 安全提示（对齐 tools.html ai-warning） */}
      <div className="ai-warning" style={{ marginBottom: 16 }}>
        <span className="ic">⚠</span>
        <div><b>Dify 不直连外部系统（CON-004）</b>。所有工具调用必经 Tool Gateway 四道关：RBAC 鉴权 → 参数白名单 → 限流 → 认证注入。</div>
      </div>

      {msg && <Feedback message={msg} />}

      {/* 工具列表（对齐 tools.html 列结构） */}
      <div className="card">
        <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
          <thead><tr><th>接口名称</th><th>标识</th><th>用途</th><th>目标系统</th><th>认证</th><th>访问角色</th><th>状态</th><th>最近调用</th><th>成功率</th><th>操作</th></tr></thead>
          <tbody>
            {tools.map((t) => (
              <tr key={t.id}>
                <td className="cell-strong">{t.name}</td>
                <td className="muted small" style={{ fontFamily: 'monospace' }}>{t.identifier}</td>
                <td className="muted small" style={{ maxWidth: 130 }}>{t.description || '—'}</td>
                <td className="muted small" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.url}>{t.url}</td>
                <td><span className="badge badge-neutral">{t.authType === 'NONE' ? '无认证' : t.authType === 'OAUTH2' ? 'OAuth2' : 'API Key'}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {(t.allowedRoles ?? []).map((r) => <span key={r} className={roleCls(r)}>{r}</span>)}
                  {!(t.allowedRoles?.length) && <span className="small muted">—</span>}
                </td>
                <td><span className={`badge ${st(t).cls}`}><span className="dot" />{st(t).label}</span></td>
                <td className="cell-muted">{relTime(t.lastCalledAt)}</td>
                <td><span className="small" style={{ color: rate(t) === '—' ? 'var(--text-muted)' : 'var(--success-text)' }}>{rate(t)}</span></td>
                <td className="cell-actions">
                  <AsyncButton className="link" onClick={() => openConfig(t)}>配置</AsyncButton>
                  {st(t).label !== '草稿' && <AsyncButton className="link" onClick={() => toggle(t)}>{t.isActive ? '禁用' : '启用'}</AsyncButton>}
                  <AsyncButton className="link danger" onClick={() => remove(t)}>删除</AsyncButton>
                </td>
              </tr>
            ))}
            {tools.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 32 }}>暂无工具，点击「新建工具」创建</td></tr>}
          </tbody>
        </table></div>
      </div>

      {/* 工具配置 Modal（对齐 tool-config.html：弹窗完整配置，编辑含⑤测试调用） */}
      {modal && (
        <ToolModal
          mode={modal.mode}
          form={form}
          jsonErr={jsonErr}
          saving={saving}
          testArgs={testArgs}
          testResult={testResult}
          onField={f}
          onRole={(r) => f('roles', toggleRole(form.roles, r))}
          onTestArgs={setTestArgs}
          onRunTest={runTest}
          onSave={modal.mode === 'create' ? create : saveConfig}
          onCancel={() => setModal(null)}
          id={modal.mode === 'edit' ? modal.id : undefined}
        />
      )}
    </PageData></>
  );
}

/** 工具新建/配置 Modal（文件级组件，与平台侧 PlatformTools Modal 结构一致） */
function ToolModal(props: {
  mode: 'create' | 'edit';
  form: CfgForm;
  jsonErr: string;
  saving: boolean;
  testArgs: string;
  testResult: { ok: boolean; text: string } | null;
  onField: (k: keyof CfgForm, v: string | string[]) => void;
  onRole: (r: string) => void;
  onTestArgs: (v: string) => void;
  onRunTest: () => void;
  onSave: () => void;
  onCancel: () => void;
  id?: string;
}) {
  const { mode, form, jsonErr, saving, testArgs, testResult, onField: f, onRole, onTestArgs, onRunTest, onSave, onCancel } = props;
  const isEdit = mode === 'edit';
  return (
    <ModalFrame title={isEdit ? '编辑工具' : '新增工具'} onClose={() => { onCancel(); }} drawer>
      <div className="modal wide">
        <div className="m-head">
          <h3>{isEdit ? `工具配置 — ${form.name}` : '新建工具（保存即发布）'}</h3>
          <AsyncButton closeDialog className="x" onClick={onCancel}>✕</AsyncButton>
        </div>
        <div className="m-body">
          <div className="form-row">
            <div className="form-item"><label>工具名称 *</label><input className="input" placeholder="如：订单查询" value={form.name} onChange={(e) => f('name', e.target.value)} /></div>
            <div className="form-item"><label>用途</label><input className="input" placeholder="如 查询订单状态/金额" value={form.description} onChange={(e) => f('description', e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="form-item"><label>标识 *（供 Dify 引用）</label>
              {isEdit
                ? <input className="input" value={form.identifier} disabled />
                : <input className="input" placeholder="order_query" value={form.identifier} onChange={(e) => f('identifier', e.target.value)} />}
            </div>
            <div className="form-item"><label>请求方法 *</label>
              <select className="select" value={form.method} onChange={(e) => f('method', e.target.value)}>
                <option>POST</option><option>GET</option><option>PUT</option>
              </select>
            </div>
          </div>
          <div className="form-item"><label>对方业务接口地址 *</label><input className="input" placeholder="https://api.xxx.com/v1/query" value={form.url} onChange={(e) => f('url', e.target.value)} /></div>
          <div className="form-item"><label>我方机器人交互请求地址</label><div style={{ display: 'flex', gap: 8 }}><input className="input mono" readOnly value={`${window.location.origin}/api/v1/tenant/messages`} /><AsyncButton className="btn btn-secondary btn-sm" onClick={async () => { await navigator.clipboard.writeText(`${window.location.origin}/api/v1/tenant/messages`); notify('我方请求地址已复制'); }}>复制</AsyncButton></div><p className="small muted">POST 请求，须携带本租户有效 Bearer 登录凭证。请求包含 robotId、channel（web）、channelUserId、content 和 isAtRobot（true）；继续补参时携带返回的 conversationId。机器人按绑定场景调用本工具。当前 localhost 地址仅供本机使用，正式对接请从已部署的公网域名访问后复制。</p></div>
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
            <textarea className="input mono" rows={2} value={form.responseText} onChange={(e) => f('responseText', e.target.value)} placeholder='["order_id", "order_status", "amount"]' />
          </div>
          <div className="form-item">
            <label>访问角色（谁可调用）</label>
            {ROLE_OPTIONS.map((r) => (
              <label key={r} className={`group-item chk-inline ${form.roles.includes(r) ? 'sel' : ''}`}>
                <input type="checkbox" checked={form.roles.includes(r)} onChange={() => onRole(r)} />{r}
              </label>
            ))}
          </div>

          {/* ⑤ 测试调用（编辑模式，参数白名单校验，不真实外呼） */}
          {isEdit && (
            <>
              <div className="divider" />
              <div className="form-item">
                <label>⑤ 测试已保存配置（修改后请先保存并重新打开）</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <textarea className="input mono" rows={2} style={{ flex: 1 }} placeholder='测试参数：{"order_id": "20260820-0001"}' value={testArgs} onChange={(e) => onTestArgs(e.target.value)} />
                  <AsyncButton className="btn btn-secondary" onClick={onRunTest}>运行测试</AsyncButton>
                </div>
                {testResult && (
                  <div className="small" style={{ marginTop: 6, color: testResult.ok ? 'var(--success-text)' : 'var(--error)', background: testResult.ok ? 'var(--success-bg)' : 'var(--error-bg)', padding: '8px 10px', borderRadius: 6 }}>
                    {testResult.text}
                  </div>
                )}
              </div>
            </>
          )}

          {jsonErr && <div className="small" style={{ color: 'var(--error)', marginBottom: 8 }}>{jsonErr}</div>}
        </div>
        <div className="m-foot">
          <AsyncButton closeDialog className="btn btn-secondary" onClick={onCancel}>取消</AsyncButton>
          <AsyncButton className="btn btn-primary" disabled={saving} onClick={onSave}>{saving ? '保存中…' : isEdit ? '保存并发布' : '创建并发布'}</AsyncButton>
        </div>
      </div>
    </ModalFrame>
  );
}
