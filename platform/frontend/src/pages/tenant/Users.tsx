import { useFeedback, PageData, Feedback, ModalFrame, AsyncButton, confirmAction } from '../../components/Interaction';
import RecordId from '../../components/RecordId';
import { useEffect, useState } from 'react';
import { api, CURRENT_TENANT_ID } from '../../api/client';
import { todayStamp } from '../../api/datetime';

const TID = CURRENT_TENANT_ID;

interface User {
  id: string; name?: string; phoneMasked?: string | null; identity: string; role?: string | null;
  knowledgeClearance?: number; department?: string | null; status: 'ACTIVE' | 'DISABLED' | 'MERGED';
  identityCount?: number; channels?: string[];
  confidence?: '高' | '低'; confidenceSource?: string | null; sourceLabel?: string;
}
interface Dept { id: string; name: string }

/** 身份徽标（原型 users.html：员工 info / 游客 neutral；客服/运营/管理员 功能色） */
const ID_BADGE: Record<string, string> = {
  '员工': 'badge-info', '客服': 'badge-success', '运营': 'badge-warning',
  '管理员': 'badge-error', '游客': 'badge-neutral', '用户': 'badge-neutral',
};
const IDENTITIES = ['游客', '员工', '用户', '客服', '运营', '管理员'];
const CHANNEL_NAME: Record<string, string> = { wecom: '企业微信', dingtalk: '钉钉', feishu: '飞书', web: 'Web' };

/** 手动设置 Modal（文件级组件：输入框不因父级重渲染重建） */
function SettingModal(props: {
  user: User | null;
  deptOptions: string[];
  roleOptions: string[];
  saving: boolean;
  onSave: (patch: { knowledgeClearance: number; identity: string; department: string; role: string; phone: string }) => void;
  onCancel: () => void;
}) {
  const { user, deptOptions, roleOptions, saving, onSave, onCancel } = props;
  const [identity, setIdentity] = useState(user?.identity ?? '游客');
  const [knowledgeClearance, setKnowledgeClearance] = useState(user?.knowledgeClearance ?? 1);
  const [department, setDepartment] = useState(user?.department ?? '');
  const [role, setRole] = useState(user?.role ?? '');
  const [phone, setPhone] = useState('');

  // 打开时重置（key 变化触发重挂）
  useEffect(() => {
    setKnowledgeClearance(user?.knowledgeClearance ?? 1);
    setIdentity(user?.identity ?? '游客'); setDepartment(user?.department ?? '');
    setRole(user?.role ?? ''); setPhone('');
  }, [user?.id]);

  return (
    <ModalFrame title="手动设置身份 —" onClose={() => { onCancel(); }}>
      <div className="modal">
        <div className="m-head"><h3>手动设置身份 — {user?.name ?? '用户'}</h3><AsyncButton closeDialog className="x" onClick={onCancel}>✕</AsyncButton></div>
        <div className="m-body">
          <div className="form-item">
            <label>身份（人工设置，优先级最高）</label>
            <select className="select" style={{ width: '100%' }} value={identity} onChange={(e) => setIdentity(e.target.value)}>
              {IDENTITIES.map((i) => <option key={i} value={i}>{i === '游客' ? '游客（重置回自动识别）' : i}</option>)}
            </select>
          </div>
          <div className="form-item">
            <label>所属部门（决定部门知识权限）</label>
            <select className="select" style={{ width: '100%' }} value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">未归属</option>
              {deptOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="form-item">
            <label>权限角色（可调用范围；空=按身份默认）</label>
            <select className="select" style={{ width: '100%' }} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">按身份默认</option>
              {roleOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="form-item">
            <label>关联手机号（可选，用于手机号认证/合并）</label>
            <input className="input" style={{ width: '100%' }} placeholder="11 位手机号" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="ai-warning info">
            <span className="ic">📌</span>
            <div>人工设置优先于自动识别（企业匹配/手机号认证）；选择「游客（重置）」清除人工设置回到自动识别结果。</div>
          </div>
        </div>
        <div className="form-item" style={{ padding: '0 24px 16px' }}>
          <label>可访问知识密级 <select className="select" value={knowledgeClearance} onChange={e => setKnowledgeClearance(Number(e.target.value))}><option value={1}>普通</option><option value={2}>内部及以下</option><option value={3}>机密及以下</option></select></label>
        </div>
        <div className="m-foot">
          <AsyncButton closeDialog className="btn btn-secondary" onClick={onCancel}>取消</AsyncButton>
          <AsyncButton className="btn btn-primary" disabled={saving} onClick={() => onSave({ knowledgeClearance, identity, department, role, phone })}>
            {saving ? '保存中…' : '保存'}
          </AsyncButton>
        </div>
      </div>
    </ModalFrame>
  );
}

/** 用户管理（对齐 users.html 原型：跨平台统一身份 · 手机号唯一标识 · 企业人员批量导入） */
export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [keyword, setKeyword] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [identityFilter, setIdentityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE'); // ACTIVE / DISABLED / ALL（软删可恢复入口）
  const [msg, setMsg] = useFeedback();
  const [importErrors, setImportErrors] = useState<Array<{ row: number; reason: string }>>([]);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importTab, setImportTab] = useState<'paste' | 'file'>('file');
  const [previewRows, setPreviewRows] = useState<Array<{ name: string; phone: string; department: string; role: string; valid: boolean; reason?: string }>>([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [syncingDirectory, setSyncingDirectory] = useState(false);
  // 手动设置
  const [settingUser, setSettingUser] = useState<User | null>(null);
  const [setting, setSetting] = useState(false);
  // 数据源
  const [depts, setDepts] = useState<Dept[]>([]);
  const [roles, setRoles] = useState<Array<{ id: string; name: string }>>([]);

  const [pageLoad, setPageLoad] = useState({ loading: true, ready: false, error: '' });
  async function load() {
    setPageLoad(old => ({ ...old, loading: true, error: '' }));
    try {
    const qs = new URLSearchParams({ tenantId: TID, status: statusFilter });
    if (keyword) qs.set('keyword', keyword);
    setUsers(await api<User[]>(`/api/v1/tenant/users?${qs}`));

      setPageLoad({ loading: false, ready: true, error: '' });
    } catch (cause) { setPageLoad(old => ({ ...old, loading: false, error: (cause as Error).message })); }
  }
  useEffect(() => {
    // 搜索 300ms 防抖（前后端约定 §4）
    const timer = setTimeout(() => { load().catch(() => {}); }, keyword ? 300 : 0);
    const refreshTimer = window.setInterval(() => load().catch(() => {}), 15000);
    return () => { clearTimeout(timer); window.clearInterval(refreshTimer); };
  }, [keyword, statusFilter]);
  useEffect(() => {
    api<Array<{ id: string; name: string }>>(`/api/v1/tenant/roles/depts?tenantId=${TID}`).then(setDepts).catch(() => {});
    api<Array<{ id: string; name: string }>>(`/api/v1/tenant/roles?tenantId=${TID}`).then(setRoles).catch(() => {});
  }, []);

  const deptOptions = [...new Set([...depts.map((d) => d.name), ...users.map((u) => u.department).filter((x): x is string => !!x)])];
  const roleOptions = [...new Set([...(roles.map((r) => r.name)), '游客', '用户', '客服', '运营', '管理员'])];

  /** 来源匹配（原型筛选：企业内部人员/企业微信/Web） */
  const matchSource = (u: User, s: string) => {
    const channels = (u.channels ?? []).map((c) => CHANNEL_NAME[c] ?? c);
    if (s === '企业内部人员') return u.identity === '员工';
    if (s === '全部来源') return true;
    return channels.includes(s);
  };
  const filtered = users.filter((u) =>
    (!sourceFilter || matchSource(u, sourceFilter)) &&
    (!identityFilter || u.identity === identityFilter));

  function exportCsv() {
    const head = '姓名,手机号(脱敏),身份,角色,部门,可信度,状态\n';
    const body = filtered.map((u) => [u.name ?? '', u.phoneMasked ?? '', u.identity, u.role ?? '', u.department ?? '', u.sourceLabel ?? '低', u.status].join(',')).join('\n');
    const blob = new Blob(['﻿' + head + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `users-${todayStamp()}.csv`;
    a.click();
  }

  /** 简易 CSV 解析（处理引号/逗号/换行） */
  function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
        else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      }
      else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  const PHONE_RE = /^1[3-9]\d{9}$/;

  function buildPreview(rows: string[][]) {
    return rows
      .map((r) => ({ name: (r[0] ?? '').trim(), phone: (r[1] ?? '').trim(), department: (r[2] ?? '').trim(), role: (r[3] ?? '').trim() }))
      .filter((r) => r.name || r.phone)
      .map((r) => {
        const valid = !!r.name && PHONE_RE.test(r.phone);
        return { ...r, valid, reason: !r.name ? '缺少姓名' : !PHONE_RE.test(r.phone) ? '手机号格式不正确' : undefined };
      });
  }

  function onFile(file: File) {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const rows = parseCsv(text.replace(/^﻿/, ''));
      const start = rows.length && /姓名|手机号|name|phone/i.test(rows[0].join(',')) ? 1 : 0;
      setPreviewRows(buildPreview(rows.slice(start)));
    };
    reader.readAsText(file, 'utf-8');
  }

  function downloadTemplate() {
    const blob = new Blob(['﻿姓名,手机号,部门,角色\n张三,13800138000,客服部,客服\n李四,13900139000,技术部,运营'], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '员工导入模板.csv';
    a.click();
  }

  /** 确认导入（错误行由后端跳过，返回摘要；对齐原型「N 行格式错误已跳过」） */
  async function doImport(rows?: Array<{ name: string; phone: string; department: string; role: string }>) {
    const employees = rows ?? buildPreview(parseCsv(importText).map((r) => r.join(',').split(/[,，\t]/))).map((r) => ({ name: r.name, phone: r.phone, department: r.department, role: r.role }));
    if (!employees.length) { setMsg('❌ 没有有效数据'); return; }
    setImporting(true); setImportErrors([]);
    try {
      const r = await api<{ created: number; updated: number; errors?: Array<{ row: number; reason: string }> }>('/api/v1/tenant/users/import-employees?tenantId=' + TID, {
        method: 'POST', body: JSON.stringify({ employees }),
      });
      const skip = r.errors?.length ?? 0;
      if (skip) {
        setImportErrors(r.errors ?? []);
        const failed = (r.errors ?? []).map(error => employees[error.row - 1]).filter(Boolean);
        setImportTab('paste'); setImportText(failed.map(row => [row.name, row.phone, row.department, row.role].join(',')).join('\n')); setPreviewRows([]);
        setMsg(`成功 ${r.created + r.updated} 人，失败 ${skip} 人。失败数据已保留，修正后可重试。`);
      } else { setMsg(`✅ 已导入 ${r.created + r.updated} 人（新增 ${r.created} / 更新 ${r.updated}）`); setShowImport(false); setImportText(''); setPreviewRows([]); setFileName(''); }
      await load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); } finally { setImporting(false); }
  }

  async function syncDirectory() {
    setSyncingDirectory(true);
    try {
      const result = await api<{ fetched: number; created: number; updated: number }>('/api/v1/tenant/users/sync-directory', {
        method: 'POST', body: JSON.stringify({}),
      });
      setMsg(`✅ 企业通讯录同步完成：拉取 ${result.fetched} 人，新增 ${result.created} 人，更新 ${result.updated} 人`);
      load();
    } catch (e) {
      setMsg('❌ ' + (e as Error).message);
    } finally {
      setSyncingDirectory(false);
    }
  }

  /** 手动设置保存（身份/部门/角色/绑定手机号） */
  async function saveSetting(patch: { knowledgeClearance: number; identity: string; department: string; role: string; phone: string }) {
    if (!settingUser) return;
    setSetting(true);
    try {
      await api(`/api/v1/tenant/users/${settingUser.id}?tenantId=${TID}`, {
        method: 'PATCH',
        body: JSON.stringify({ knowledgeClearance: patch.knowledgeClearance, identity: patch.identity, department: patch.department, role: patch.role, phone: patch.phone || undefined }),
      });
      setMsg(`✅ 已更新 ${settingUser.name ?? '用户'}（身份: ${patch.identity}）`);
      setSettingUser(null); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); } finally { setSetting(false); }
  }

  /** 删除用户（软删 + 正反向验证，可恢复） */
  async function removeUser(u: User) {
    if (!(await confirmAction(`确认删除用户「${u.name ?? '未命名'}」？删除后消息不再处理（软删可恢复，正反向验证）`, { confirmText: '确认删除' }))) return;
    try {
      await api(`/api/v1/tenant/users/${u.id}?tenantId=${TID}`, { method: 'DELETE', body: JSON.stringify({ verify: { positive: true, negative: true } }) });
      setMsg(`✅ 已删除「${u.name ?? '用户'}」（软删，可恢复）`);
      load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  /** 恢复已删除用户（软删可恢复入口） */
  async function restoreUser(u: User) {
    if (!(await confirmAction(`确认恢复用户「${u.name ?? '未命名'}」？恢复后消息处理能力即时生效`, { confirmText: '确认恢复' }))) return;
    try {
      await api(`/api/v1/tenant/users/${u.id}?tenantId=${TID}`, { method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) });
      setMsg(`✅ 已恢复「${u.name ?? '用户'}」`);
      load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  const validCount = previewRows.filter((r) => r.valid).length;

  return (
    <><PageData state={pageLoad} onRetry={load}>
      <div className="page-header">
        <div>
          <h1>用户管理</h1>
          <div className="desc">跨平台统一身份 · 手机号为唯一标识 · 支持企业通讯录同步与批量导入</div>
        </div>
        <div className="head-actions">
          <AsyncButton className="btn btn-primary" disabled={syncingDirectory} onClick={syncDirectory}>{syncingDirectory ? '同步中…' : '同步企业通讯录'}</AsyncButton>
          <AsyncButton className="btn btn-secondary" onClick={() => { setImportTab('file'); setPreviewRows([]); setFileName(''); setImportText(''); setShowImport(true); }}>导入企业内部人员</AsyncButton>
          <AsyncButton className="btn btn-ghost" onClick={exportCsv}>导出</AsyncButton>
        </div>
      </div>

      {msg && <Feedback message={msg} />}

      {/* 筛选卡（对齐原型：搜索 + 来源 + 身份） */}
      <div className="card" style={{ padding: '16px 24px', marginBottom: 16 }}>
        <div className="flex gap-3">
          <div className="search"><span className="ic">🔍</span><input className="input" placeholder="搜索昵称 / 手机号 / 来源ID" value={keyword} onChange={(e) => setKeyword(e.target.value)} /></div>
          <select className="select" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="">全部来源</option>
            <option value="企业内部人员">企业内部人员</option>
            <option value="企业微信">企业微信</option>
            <option value="钉钉">钉钉</option>
            <option value="飞书">飞书</option>
            <option value="Web">Web</option>
          </select>
          <select className="select" value={identityFilter} onChange={(e) => setIdentityFilter(e.target.value)}>
            <option value="">全部身份</option>
            {IDENTITIES.map((i) => <option key={i}>{i}</option>)}
          </select>
          <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ACTIVE">已启用</option>
            <option value="DISABLED">已删除（可恢复）</option>
            <option value="ALL">全部</option>
          </select>
        </div>
      </div>

      {/* 用户列表（对齐原型列结构） */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
            <thead><tr><th>用户</th><th>手机号（唯一身份）</th><th>来源 / 合并</th><th>身份</th><th>部门</th><th>角色</th><th>可信度</th><th>操作</th></tr></thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td className="cell-strong">{u.name ?? '(未命名)'}<RecordId label="用户 ID" value={u.id} /></td>
                  <td className="mono muted">{u.phoneMasked ?? '—'}</td>
                  <td className="small muted" style={{ whiteSpace: 'nowrap' }}>
                    {(u.channels ?? []).map((c) => CHANNEL_NAME[c] ?? c).join(' · ') || '—'}
                    {u.identity === '员工' && <span className="merge-tag" style={{ marginLeft: 4 }}>企业内部人员</span>}
                    {(u.identityCount ?? 0) > 1 && <span className="merge-tag">{u.identityCount} 身份已合并</span>}
                    {!u.phoneMasked && u.identity === '游客' && <span className="small muted">（未提供手机号）</span>}
                  </td>
                  <td><span className={`badge ${ID_BADGE[u.identity] ?? 'badge-neutral'}`}>{u.identity}</span></td>
                  <td className="cell-muted">{u.department ?? '—'}</td>
                  <td className="cell-muted">{u.role ?? '—'}</td>
                  <td><span className={`badge ${u.confidence === '高' ? 'badge-success' : 'badge-neutral'}`}>{u.sourceLabel ?? '低'}</span></td>
                  <td className="cell-actions">
                    {u.status === 'DISABLED'
                      ? <AsyncButton className="link" style={{ color: 'var(--success-text)' }} onClick={() => restoreUser(u)}>恢复</AsyncButton>
                      : <>
                        <AsyncButton className="link" onClick={() => setSettingUser(u)}>手动设置</AsyncButton>
                        <AsyncButton className="link danger" onClick={() => removeUser(u)}>删除</AsyncButton>
                      </>}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 32, textAlign: 'center' }} className="muted">暂无用户（消息对话后自动创建）</td></tr>
              )}
            </tbody>
          </table></div>
        </div>
      </div>

      {/* 身份合并机制说明（对齐原型 banner，移表格下方） */}
      <div className="ai-warning info mt-4">
        <span className="ic">🔑</span>
        <div><b>身份合并机制</b>：未提供手机号 → 每群独立临时身份（guest）；任一时刻提供手机号 → 以手机号为主键查重，<b>手机号一致的多个用户自动合并</b>（user_id 统一、渠道身份与群角色归并，合并写审计 BR-009）。</div>
      </div>

      {/* 手动设置 Modal（对齐原型 manualModal） */}
      {settingUser && (
        <SettingModal
          key={settingUser.id}
          user={settingUser}
          deptOptions={deptOptions}
          roleOptions={roleOptions}
          saving={setting}
          onSave={saveSetting}
          onCancel={() => setSettingUser(null)}
        />
      )}

      {/* 导入 Modal（对齐原型 importModal） */}
      {showImport && (
        <ModalFrame title="导入企业内部人员" onClose={() => { setShowImport(false); }} drawer>
          <div className="modal wide">
            <div className="m-head"><h3>导入企业内部人员</h3><AsyncButton closeDialog className="x" onClick={() => setShowImport(false)}>✕</AsyncButton></div>
            <div className="m-body">
              {!!importErrors.length && <ul className="ui-form-error" role="alert">{importErrors.map(error => <li key={error.row}>原第 {error.row} 行：{error.reason}</li>)}</ul>}
              <div className="ai-warning info">
                <span className="ic">📥</span>
                <div><AsyncButton className="link" onClick={downloadTemplate}>下载导入模板</AsyncButton> · 必填：姓名、手机号（身份识别企业匹配）；选填：部门、角色 · 单次 ≤ 2000 行</div>
              </div>
              <div className="flex gap-3 mt-3" style={{ marginBottom: 12 }}>
                <AsyncButton className={`btn btn-sm ${importTab === 'file' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setImportTab('file')}>📄 上传表格</AsyncButton>
                <AsyncButton className={`btn btn-sm ${importTab === 'paste' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setImportTab('paste')}>📋 粘贴文本</AsyncButton>
              </div>
              {importTab === 'file' ? (
                <>
                  <label style={{ display: 'block', border: '1.5px dashed var(--border)', borderRadius: 8, padding: 22, textAlign: 'center', cursor: 'pointer', marginBottom: 12 }}>
                    <input type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
                    <div style={{ fontSize: 26, marginBottom: 6 }}>📤</div>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{fileName || '点击选择 CSV 表格文件'}</div>
                    <div className="small muted" style={{ marginTop: 4 }}>表头：姓名,手机号,部门,角色 · 格式错误行自动跳过 · ≤2000 行</div>
                  </label>
                  {previewRows.length > 0 && (
                    <>
                      <div className="card" style={{ padding: '12px 16px', border: '1px dashed var(--border)', marginBottom: 12 }}>
                        <span className="badge badge-success">{validCount === previewRows.length ? '校验通过' : `${validCount}/${previewRows.length} 行有效`}</span>
                        <span className="small muted" style={{ marginLeft: 8 }}>
                          新增/更新按手机号自动去重 · {previewRows.length - validCount > 0 ? `${previewRows.length - validCount} 行格式错误将被跳过` : '无格式错误'}
                        </span>
                      </div>
                      <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 160, overflowY: 'auto', marginBottom: 12 }}>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <thead><tr style={{ background: 'var(--bg-hover)' }}>
                            {['姓名', '手机号', '部门', '角色', '校验'].map((h) => <th key={h} style={{ padding: '6px 10px', textAlign: 'left' }}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {previewRows.slice(0, 6).map((r, i) => (
                              <tr key={i} style={!r.valid ? { background: 'var(--error-bg)' } : {}}>
                                <td style={{ padding: '5px 10px' }}>{r.name}</td>
                                <td style={{ padding: '5px 10px' }}>{r.phone}</td>
                                <td style={{ padding: '5px 10px' }}>{r.department}</td>
                                <td style={{ padding: '5px 10px' }}>{r.role}</td>
                                <td style={{ padding: '5px 10px' }}>{r.valid ? <span className="badge badge-success">✓</span> : <span className="badge badge-error">{r.reason}</span>}</td>
                              </tr>
                            ))}
                            {previewRows.length > 6 && <tr><td colSpan={5} style={{ padding: '5px 10px', textAlign: 'center' }} className="muted">…共 {previewRows.length} 行</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="small muted" style={{ marginBottom: 6 }}>每行一条：<span className="mono">姓名,手机号,部门,角色</span>（手机号=唯一身份，重复导入自动更新）</div>
                  <textarea className="input" style={{ width: '100%', minHeight: 120, fontFamily: 'monospace', fontSize: 12 }} placeholder={'张三,13800138000,客服部,客服\n李四,13900139000,技术部,运营'} value={importText} onChange={(e) => setImportText(e.target.value)} />
                </>
              )}
              <div className="small muted">📌 手机号仅保存不可逆身份指纹与脱敏展示值（138****6688）；导入和通讯录同步操作会写入审计日志。</div>
            </div>
            <div className="m-foot">
              <AsyncButton closeDialog className="btn btn-secondary" onClick={() => setShowImport(false)}>取消</AsyncButton>
              <AsyncButton
                className="btn btn-primary" disabled={importing}
                onClick={() => doImport(importTab === 'file' ? previewRows.map((r) => ({ name: r.name, phone: r.phone, department: r.department, role: r.role })) : undefined)}
              >
                {importing ? '导入中…' : previewRows.length ? `确认导入 ${previewRows.length} 行` : '确认导入'}
              </AsyncButton>
            </div>
          </div>
        </ModalFrame>
      )}
    </PageData></>
  );
}
