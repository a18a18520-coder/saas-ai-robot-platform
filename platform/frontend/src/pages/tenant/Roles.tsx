import { useFeedback, Modal, LoadState, Feedback, usePageTab, TabBar, TabPanel, ModalFrame, AsyncButton, confirmAction } from '../../components/Interaction';
import { useEffect, useState } from 'react';
import { api, CURRENT_TENANT_ID } from '../../api/client';

const TID = CURRENT_TENANT_ID;

interface Role { id: string; name: string; isBuiltin: boolean; status: 'ACTIVE' | 'DISABLED'; windowPermissions: string[]; accountCount: number }
interface Dept { id: string; name: string }
interface KB { id: string; datasetId: string; name: string; visibility: string }

const WINDOW_PERMISSIONS = [
  { key: 'dashboard', label: '工作台', description: '租户概览与核心指标' },
  { key: 'notifications', label: '通知', description: '站内通知与未读提醒' },
  { key: 'robots', label: '机器人管理', description: '机器人配置、发布与 Dify 资源' },
  { key: 'channels', label: '渠道接入', description: '企业微信、飞书、钉钉等渠道' },
  { key: 'groups', label: '群管理', description: '群配置与机器人绑定' },
  { key: 'messages', label: '消息测试', description: '消息调试与发送验证' },
  { key: 'broadcast', label: '消息发送', description: '批量广播与发送记录' },
  { key: 'follow-ups', label: '待跟进', description: '跟进任务与处理状态' },
  { key: 'sessions', label: '会话管理', description: '会话与消息记录' },
  { key: 'users', label: '用户管理', description: '用户、身份与通讯录同步' },
  { key: 'roles', label: '角色权限', description: '角色及权限矩阵配置' },
  { key: 'knowledge', label: '知识库', description: '知识库和文件管理' },
  { key: 'tools', label: '外部接口', description: '租户工具与接口配置' },
  { key: 'audit', label: '审计中心', description: 'AI 审计与命中记录' },
  { key: 'logs', label: '操作日志', description: '管理操作与系统日志' },
  { key: 'settings', label: '租户管理', description: '套餐、账号和安全设置' },
] as const;

/** 名称输入 Modal（顶层定义：避免每次渲染重建组件类型导致 input 卸载重挂、拼音输入被中断） */
function NameModal({ title, value, onChange, onOk, onCancel }: { title: string; value: string; onChange: (v: string) => void; onOk: () => void; onCancel: () => void }) {
  return (
    <ModalFrame title={title} onClose={() => { onCancel(); }}>
      <div className="card" style={{ width: 380, maxWidth: '94vw' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="card-title">{title}</div>
          <AsyncButton closeDialog style={{ cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)' }} onClick={onCancel}>✕</AsyncButton>
        </div>
        <input
          className="input" style={{ width: '100%', marginBottom: 14 }} placeholder="名称"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          // 输入法保护：composition（拼音选词）期间按 Enter 不触发创建，避免误提交候选词
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && onOk()}
          autoFocus
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <AsyncButton closeDialog className="btn btn-secondary" onClick={onCancel}>取消</AsyncButton>
          <AsyncButton className="btn btn-primary" onClick={onOk}>创建</AsyncButton>
        </div>
      </div>
    </ModalFrame>
  );
}

export default function Roles() {
  const [tab, setTab] = usePageTab('role', ["role","dept"] as const, 'tab');
  const [roles, setRoles] = useState<Role[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [kbs, setKbs] = useState<KB[]>([]);
  const [robots, setRobots] = useState<Array<{ id: string; name: string }>>([]);
  const [permissionLoading, setPermissionLoading] = useState(false), [permissionSaving, setPermissionSaving] = useState(false), [permissionError, setPermissionError] = useState('');
  const [activeRole, setActiveRole] = useState('');
  const [activeDept, setActiveDept] = useState('');
  const [windowPerms, setWindowPerms] = useState<string[]>([]);
  const [kbPerms, setKbPerms] = useState<string[]>([]);
  const [toolPerms, setToolPerms] = useState<string[]>([]);
  const [robotPerms, setRobotPerms] = useState<string[]>([]);
  const [deptKbs, setDeptKbs] = useState<string[]>([]);
  const [msg, setMsg] = useFeedback();
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [roleName, setRoleName] = useState('');
  const [roleTemplate, setRoleTemplate] = useState(''); // 权限模板（从现有角色复制，后端 copyFromId）
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [deptName, setDeptName] = useState('');

  async function loadRoles() {
    const rs = await api<Role[]>(`/api/v1/tenant/roles?tenantId=${TID}`);
    setRoles(rs);

  }
  async function loadDepts() {
    const ds = await api<Dept[]>(`/api/v1/tenant/roles/depts?tenantId=${TID}`);
    setDepts(ds);

  }
  useEffect(() => {
    loadRoles().catch(e => setMsg(e.message)); loadDepts().catch(e => setMsg(e.message));
    api<KB[]>(`/api/v1/tenant/knowledge-base?tenantId=${TID}`).then(setKbs).catch(() => {});
    api<Array<{ id: string; name: string }>>(`/api/v1/tenant/robots?tenantId=${TID}`).then(setRobots).catch(() => {});
  }, []);

  async function selectRole(id: string) {
    setActiveRole(id); setPermissionLoading(true); setPermissionError('');
    try { const p = await api<{ window: string[]; kb: string[]; tool: string[]; robot: string[] }>(`/api/v1/tenant/roles/${id}/permissions`);
    setWindowPerms(p.window ?? []); setKbPerms(p.kb ?? []); setToolPerms(p.tool ?? []); setRobotPerms(p.robot ?? []); } catch (cause) { setPermissionError((cause as Error).message); } finally { setPermissionLoading(false); }
  }
  async function selectDept(id: string) {
    setActiveDept(id); setPermissionLoading(true); setPermissionError('');
    try { setDeptKbs(await api<string[]>(`/api/v1/tenant/roles/depts/${id}/kbs`)); } catch (cause) { setPermissionError((cause as Error).message); } finally { setPermissionLoading(false); }
  }

  async function createRole() {
    if (!roleName.trim()) return;
    try {
      await api('/api/v1/tenant/roles', { method: 'POST', body: JSON.stringify({ tenantId: TID, name: roleName.trim(), copyFromId: roleTemplate || undefined }) });
      setMsg(`✅ 角色「${roleName}」已创建${roleTemplate ? `（权限模板：${roles.find((r) => r.id === roleTemplate)?.name ?? ''}）` : ''}`);
      setShowRoleModal(false); setRoleName(''); setRoleTemplate(''); loadRoles();
    }
    catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function removeRole(r: Role) {
    if (r.isBuiltin) { setMsg('⚠️ 内置角色不可删除'); return; }
    if (r.accountCount > 0) { setMsg(`⚠️ 角色「${r.name}」仍关联 ${r.accountCount} 个管理账号，请先调整账号角色`); return; }
    if (!(await confirmAction(`确认删除角色「${r.name}」？`, { confirmText: '确认删除' }))) return;
    try { await api(`/api/v1/tenant/roles/${r.id}`, { method: 'DELETE' }); setMsg(`✅ 已删除「${r.name}」`); setActiveRole(''); loadRoles(); }
    catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function savePerms(type: 'window' | 'kb' | 'tool' | 'robot', ids: string[]) {
    if (!activeRole || permissionSaving) return; setPermissionSaving(true);
    try {
      await api(`/api/v1/tenant/roles/${activeRole}/permissions/${type}`, { method: 'PUT', body: JSON.stringify({ resourceIds: ids }) });
      setMsg('✅ 权限已保存，已关联账号将在下一次请求时刷新授权');
    } catch (e) {
      setMsg('❌ ' + (e as Error).message);
      await selectRole(activeRole);
    } finally { setPermissionSaving(false); }
  }

  async function createDept() {
    if (!deptName.trim()) return;
    try { await api('/api/v1/tenant/roles/depts', { method: 'POST', body: JSON.stringify({ tenantId: TID, name: deptName.trim() }) }); setMsg(`✅ 部门「${deptName}」已创建`); setShowDeptModal(false); setDeptName(''); loadDepts(); }
    catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function removeDept(d: Dept) {
    if (!(await confirmAction(`确认删除部门「${d.name}」？`, { confirmText: '确认删除' }))) return;
    try { await api(`/api/v1/tenant/roles/depts/${d.id}`, { method: 'DELETE' }); setMsg(`✅ 已删除「${d.name}」`); setActiveDept(''); loadDepts(); }
    catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function saveDeptKbs(ids: string[]) {
    if (!activeDept || permissionSaving) return; setPermissionSaving(true);
    try { await api(`/api/v1/tenant/roles/depts/${activeDept}/kbs`, { method: 'PUT', body: JSON.stringify({ knowledgeIds: ids }) });
    setMsg('✅ 部门知识权限已保存'); } catch (cause) { setMsg('❌ ' + (cause as Error).message); await selectDept(activeDept); } finally { setPermissionSaving(false); }
  }

  const toggle = (arr: string[], id: string) => arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
  const kbMeta = (kb: KB) => ({
    badge: kb.visibility === 'all' ? { label: '🔓 全部门', cls: 'badge-success' } : { label: '🔐 部门限定', cls: 'badge-warning' },
  });
  const selectedRole = roles.find((role) => role.id === activeRole);
  const administratorLocked = !!selectedRole?.isBuiltin && selectedRole.name === '管理员';

  return (
    <>
      <div className="page-header">
        <div>
          <h1>角色权限</h1>
          <div className="desc">一个角色统一控制管理后台功能、知识库、工具与机器人权限，并可直接关联管理账号。</div>
        </div>
      </div>

      {msg && <Feedback message={msg} />}

      <TabBar name="tab" items={[["role","角色权限"],["dept","部门权限"]] as const} value={tab} onChange={setTab} />

      <TabPanel name="tab" id="role" active={tab}><div >
          <div className="card" style={{ padding: 10 }}>
            {roles.map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 14, marginBottom: 4, ...(activeRole === r.id ? { background: 'var(--primary-light)', color: 'var(--primary-700)', fontWeight: 500 } : {}) }}>
                <AsyncButton className="link" onClick={() => selectRole(r.id)}>{r.name}{r.isBuiltin && <span className="small muted" style={{ marginLeft: 6 }}>内置</span>}{r.accountCount > 0 && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>{r.accountCount} 个账号</span>}</AsyncButton>
                {!r.isBuiltin && <AsyncButton className="link danger small" style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); return removeRole(r); }}>✕</AsyncButton>}
              </div>
            ))}
            <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }} onClick={() => setShowRoleModal(true)} style={{ padding: '10px 14px', borderTop: '1px dashed var(--border)', color: 'var(--primary)', cursor: 'pointer', fontSize: 14 }}>+ 新建角色</div>
          </div>
          {activeRole && <Modal title="角色权限配置" drawer dirty={false} onClose={() => setActiveRole('')}><LoadState loading={permissionLoading} error={permissionError} onRetry={() => selectRole(activeRole)}><fieldset className="wiki-editor-fields" disabled={permissionSaving}><div className="card">
            <div className="card-title" style={{ marginBottom: 8 }}>权限矩阵 — {roles.find((r) => r.id === activeRole)?.name}</div>
            <div className="card-sub" style={{ marginBottom: 10 }}>管理后台功能</div>
            <div className="permission-grid tenant-window-permissions">
              {WINDOW_PERMISSIONS.map((permission) => {
                const checked = windowPerms.includes(permission.key);
                return (
                  <label key={permission.key} className={`permission-option ${checked ? 'selected' : ''} ${administratorLocked ? 'locked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={administratorLocked}
                      onChange={() => {
                        const next = toggle(windowPerms, permission.key);
                        setWindowPerms(next);
                        void savePerms('window', next);
                      }}
                    />
                    <span><strong>{permission.label}</strong><small>{permission.description}</small></span>
                  </label>
                );
              })}
            </div>
            {administratorLocked && <div className="small muted" style={{ marginTop: 8 }}>内置管理员固定保留全部后台权限，避免租户失去账号和权限管理能力。</div>}
            <div className="card-sub" style={{ margin: '20px 0 12px' }}>知识库（真实数据源 + 可见性）</div>
            {kbs.map((kb) => (
              <label key={kb.id} className="flex gap-3" style={{ gap: 8, padding: '8px 0', fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={kbPerms.includes(kb.datasetId)} onChange={() => { const next = toggle(kbPerms, kb.datasetId); setKbPerms(next); savePerms('kb', next); }} style={{ accentColor: 'var(--primary)' }} />
                {kb.name}
                <span className={`badge ${kbMeta(kb).badge.cls}`} style={{ fontSize: 10 }}>{kbMeta(kb).badge.label}</span>
              </label>
            ))}
            {kbs.length === 0 && <div className="small muted">暂无知识库（先创建知识库再配置权限）</div>}
            <div className="card-sub" style={{ margin: '16px 0 12px' }}>工具（Tool Gateway 鉴权）</div>
            {['order_query', 'refund_apply'].map((t) => (
              <label key={t} className="flex gap-3" style={{ gap: 8, padding: '8px 0', fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={toolPerms.includes(t)} onChange={() => { const next = toggle(toolPerms, t); setToolPerms(next); savePerms('tool', next); }} style={{ accentColor: 'var(--primary)' }} />
                {t}
              </label>
            ))}
            <div className="card-sub" style={{ margin: '16px 0 12px' }}>机器人（谁可以使用哪些机器人）</div>
            {robots.map((r) => (
              <label key={r.id} className="flex gap-3" style={{ gap: 8, padding: '8px 0', fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={robotPerms.includes(r.id)} onChange={() => { const next = toggle(robotPerms, r.id); setRobotPerms(next); savePerms('robot', next); }} style={{ accentColor: 'var(--primary)' }} />
                🤖 {r.name}
              </label>
            ))}
            {robots.length === 0 && <div className="small muted">暂无机器人</div>}
          </div></fieldset></LoadState></Modal>}
        </div></TabPanel>

      <TabPanel name="tab" id="dept" active={tab}><div >
          <div className="card" style={{ padding: 10 }}>
            {depts.map((d) => (
              <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 14, marginBottom: 4, ...(activeDept === d.id ? { background: 'var(--primary-light)', color: 'var(--primary-700)', fontWeight: 500 } : {}) }}>
                <AsyncButton className="link" onClick={() => selectDept(d.id)}>{d.name}</AsyncButton>
                <AsyncButton closeDialog className="small muted" style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); return removeDept(d); }}>✕</AsyncButton>
              </div>
            ))}
            <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }} onClick={() => setShowDeptModal(true)} style={{ padding: '10px 14px', borderTop: '1px dashed var(--border)', color: 'var(--primary)', cursor: 'pointer', fontSize: 14 }}>+ 新建部门</div>
          </div>
          {activeDept && <Modal title="部门知识权限" drawer dirty={false} onClose={() => setActiveDept('')}><LoadState loading={permissionLoading} error={permissionError} onRetry={() => selectDept(activeDept)}><fieldset className="wiki-editor-fields" disabled={permissionSaving}><div className="card">
            <div className="card-title" style={{ marginBottom: 8 }}>部门知识权限 — {depts.find((d) => d.id === activeDept)?.name}</div>
            <div className="card-sub" style={{ marginBottom: 12 }}>可检索范围 = 角色白名单 ∩ 部门知识范围 ∩ 文件密级（BR-008）</div>
            {kbs.map((kb) => (
              <label key={kb.id} className="flex gap-3" style={{ gap: 8, padding: '8px 0', fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={deptKbs.includes(kb.datasetId)} onChange={() => { const next = toggle(deptKbs, kb.datasetId); setDeptKbs(next); saveDeptKbs(next); }} style={{ accentColor: 'var(--primary)' }} />
                {kb.name}
                <span className={`badge ${kbMeta(kb).badge.cls}`} style={{ fontSize: 10 }}>{kbMeta(kb).badge.label}</span>
              </label>
            ))}
            {kbs.length === 0 && <div className="small muted">暂无知识库</div>}
            <div className="ai-warning mt-4">
              <span className="ic">⚠</span>
              <div>机密（🔒）知识库默认仅指定部门可见，未授权部门检索该密级内容将返回<b>权限拒绝</b>并写审计。</div>
            </div>
          </div></fieldset></LoadState></Modal>}
        </div></TabPanel>

      {showRoleModal && (
        <ModalFrame title="新建角色" onClose={() => { setShowRoleModal(false); }}>
          <div className="card" style={{ width: 380, maxWidth: '94vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="card-title">新建角色</div>
              <AsyncButton closeDialog style={{ cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)' }} onClick={() => setShowRoleModal(false)}>✕</AsyncButton>
            </div>
            <input
              className="input" style={{ width: '100%', marginBottom: 14 }} placeholder="名称"
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && createRole()}
              autoFocus
            />
            <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>权限模板（可选，从现有角色复制）</div>
            <select className="select" style={{ width: '100%', marginBottom: 14 }} value={roleTemplate} onChange={(e) => setRoleTemplate(e.target.value)}>
              <option value="">空白角色</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}{r.isBuiltin ? '（内置）' : ''}</option>)}
            </select>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <AsyncButton closeDialog className="btn btn-secondary" onClick={() => setShowRoleModal(false)}>取消</AsyncButton>
              <AsyncButton className="btn btn-primary" onClick={createRole}>创建</AsyncButton>
            </div>
          </div>
        </ModalFrame>
      )}
      {showDeptModal && <NameModal title="新建部门" value={deptName} onChange={setDeptName} onOk={createDept} onCancel={() => setShowDeptModal(false)} />}
    </>
  );
}
