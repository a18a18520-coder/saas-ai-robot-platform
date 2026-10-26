import { useFeedback, PageData, Feedback, AsyncButton, ModalFrame } from '../components/Interaction';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Tenant } from '../api/client';
import LifecycleConfirm from '../components/LifecycleConfirm';

interface Plan {
  id: string; name: string; price: number; robotLimit: number; userLimit: number; kbLimit: number;
  aiQuota: number; validityDays: number; fileSizeLimitMb: number; storageLimitMb: number; channelLimit: number; adminWindowLimit: number;
  isActive: boolean; isFeatured: boolean;
}

const fmt = (n: number) => (n > 0 ? n : '不限');
const fmtPrice = (n: number) => (n > 0 ? `¥${n.toLocaleString()}` : '¥0');

/** 套餐管理（对齐原型 plans.html）：真实 CRUD */
export default function Plans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [msg, setMsg] = useFeedback();
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState<Partial<Plan>>({ name: '', price: 0, robotLimit: 5, userLimit: 200, kbLimit: 5, aiQuota: 3000, validityDays: 30, fileSizeLimitMb: 0, storageLimitMb: 512, channelLimit: 2, adminWindowLimit: 0, isFeatured: false });
  const [editId, setEditId] = useState('');
  const [planUsage, setPlanUsage] = useState<Record<string, number>>({});
  // 停用/删除确认弹窗（lifecycle.js 对齐）
  const [confirm, setConfirm] = useState<{ kind: 'toggle' | 'remove'; p: Plan } | null>(null);

  const [pageLoad, setPageLoad] = useState({ loading: true, ready: false, error: '' });
  async function load() {
    setPageLoad(old => ({ ...old, loading: true, error: '' }));
    try {
    const d = await api<Plan[]>('/api/v1/admin/plans');
    setPlans(Array.isArray(d) ? d : (d as { list: Plan[] }).list ?? []);
    // 在用租户统计（plans.html「在用租户」列 + 编辑弹窗影响面警示）
    const ts = await api<Tenant[]>('/api/v1/admin/tenants').catch(() => []);
    const cnt: Record<string, number> = {};
    for (const t of ts) cnt[t.planId] = (cnt[t.planId] ?? 0) + 1;
    setPlanUsage(cnt);

      setPageLoad({ loading: false, ready: true, error: '' });
    } catch (cause) { setPageLoad(old => ({ ...old, loading: false, error: (cause as Error).message })); }
  }
  useEffect(() => { load().catch(() => {}); }, []);

  function openCreate() { setEditId(''); setForm({ name: '', price: 0, robotLimit: 5, userLimit: 200, kbLimit: 5, aiQuota: 3000, validityDays: 30, fileSizeLimitMb: 0, storageLimitMb: 512, channelLimit: 2, adminWindowLimit: 0, isFeatured: false }); setShowEdit(true); }
  function openEdit(p: Plan) { setEditId(p.id); setForm({ ...p }); setShowEdit(true); }

  async function save() {
    try {
      await api(editId ? `/api/v1/admin/plans/${editId}` : '/api/v1/admin/plans', {
        method: editId ? 'PATCH' : 'POST',
        body: JSON.stringify(form),
      });
      setMsg(`✅ 套餐「${form.name}」已${editId ? '更新' : '创建'}（即时生效）`);
      setShowEdit(false); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function toggleActive(p: Plan) {
    await api(`/api/v1/admin/plans/${p.id}/active`, { method: 'POST', body: JSON.stringify({ isActive: !p.isActive }) });
    setMsg(p.isActive ? `✅ 已停用「${p.name}」` : `✅ 已启用「${p.name}」`);
    setConfirm(null);
    load();
  }

  async function remove(p: Plan) {
    try {
      await api(`/api/v1/admin/plans/${p.id}`, { method: 'DELETE' });
      setMsg(`✅ 已删除「${p.name}」`);
      setConfirm(null);
      load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  const num = (k: keyof typeof form) => Number(form[k] ?? 0);

  return (
    <><PageData state={pageLoad} onRetry={load}>
      <div className="page-header">
        <div>
          <h1>套餐管理</h1>
          <div className="desc">平台套餐档位列表 · 30 天周期计价 · 资源限制配置（修改即时生效并写审计）</div>
        </div>
        <AsyncButton className="btn btn-primary" onClick={openCreate}>+ 新增套餐</AsyncButton>
      </div>

      {msg && <Feedback message={msg} />}

      <div className="card">
        <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
          <thead><tr><th>套餐</th><th>价格（元/周期）</th><th>机器人</th><th>用户</th><th>知识库</th><th>AI 调用</th><th>单文件上限</th><th>总容量</th><th>有效天数</th><th>渠道</th><th>管理群上限</th><th>在用租户</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} style={p.isFeatured ? { background: 'var(--primary-light)' } : {}}>
                <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}{p.isFeatured && <span className="badge badge-info" style={{ marginLeft: 8 }}>主推</span>}</td>
                <td style={{ fontWeight: 600 }}>{fmtPrice(p.price)}</td>
                <td>{fmt(p.robotLimit)}</td><td>{fmt(p.userLimit)}</td><td>{fmt(p.kbLimit)}</td>
                <td>{fmt(p.aiQuota)}</td><td>{p.fileSizeLimitMb > 0 ? `${p.fileSizeLimitMb}MB` : '不限'}</td><td>{fmt(p.storageLimitMb)}MB</td><td>{p.validityDays} 天</td><td>{fmt(p.channelLimit)}</td><td>{fmt(p.adminWindowLimit)}</td>
                <td><span className={`badge ${(planUsage[p.id] ?? 0) > 0 ? 'badge-info' : 'badge-neutral'}`}>{planUsage[p.id] ?? 0} 租户</span></td>
                <td><span className={`badge ${p.isActive ? 'badge-success' : 'badge-warning'}`}>{p.isActive ? '启用' : '停用'}</span></td>
                <td>
                  <AsyncButton className="link" onClick={() => openEdit(p)}>编辑</AsyncButton>
                  <AsyncButton className="link" style={{ marginLeft: 10 }} onClick={() => setConfirm({ kind: 'toggle', p })}>{p.isActive ? '停用' : '启用'}</AsyncButton>
                  <AsyncButton className="link" style={{ marginLeft: 10, color: 'var(--error)' }} onClick={() => setConfirm({ kind: 'remove', p })}>删除</AsyncButton>
                </td>
              </tr>
            ))}
            {plans.length === 0 && <tr><td colSpan={14} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 32 }}>暂无套餐</td></tr>}
          </tbody>
        </table></div>
        <div className="small muted mt-4">计价规则：升级补差价 = 新套餐价 −（旧套餐价 ÷ 30 × 已用天数）；降级不退款；修改即时生效写审计；删除在用套餐需先迁移。</div>
      </div>

      {confirm && (
        <LifecycleConfirm
          title={confirm.kind === 'toggle' ? `${confirm.p.isActive ? '停用' : '启用'}套餐 — ${confirm.p.name}` : `删除套餐 — ${confirm.p.name}`}
          description={confirm.kind === 'toggle'
            ? (confirm.p.isActive ? '停用后新租户不可选择该套餐，在用租户不受影响。' : '启用后该套餐对新租户开放。')
            : '删除不可恢复；有租户在用时后端将拒绝并提示先迁移。'}
          impacts={confirm.kind === 'toggle'
            ? [`在用租户 ${planUsage[confirm.p.id] ?? 0} 个（不受停用影响）`, '套餐开关状态写入审计']
            : [`在用租户 ${planUsage[confirm.p.id] ?? 0} 个`, '删除动作写入审计（正反向验证）']}
          onConfirm={() => (confirm.kind === 'toggle' ? toggleActive(confirm.p) : remove(confirm.p))}
          onCancel={() => setConfirm(null)}
        />
      )}

      {showEdit && (
        <ModalFrame title={editId ? '编辑套餐' : '新增套餐'} drawer onClose={() => { setShowEdit(false); }}>
          <div className="card" style={{ width: 560, maxWidth: '94vw', maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="card-title">{editId ? '编辑套餐' : '新增套餐'}</div>
              <AsyncButton closeDialog style={{ cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)' }} onClick={() => setShowEdit(false)}>✕</AsyncButton>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <input className="input" placeholder="套餐名称 *" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <div>
                <div className="small" style={{ marginBottom: 4 }}>价格（元/周期）*</div>
                <input className="input" type="number" min={0} placeholder="如 999" value={String(form.price ?? 0)} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
              </div>
              <label className="flex gap-3 small" style={{ alignItems: 'center' }}>
                <input type="checkbox" checked={!!form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} style={{ accentColor: 'var(--primary)' }} /> 主推套餐
              </label>
              {([['robotLimit', '机器人配额'], ['userLimit', '用户配额'], ['kbLimit', '知识库配额'], ['aiQuota', 'AI 受理次数额度'], ['fileSizeLimitMb', '单文件大小上限 MB（同时受系统 15 MB 限制）'], ['storageLimitMb', '知识库总容量 MB'], ['validityDays', '有效天数'], ['channelLimit', '渠道配额'], ['adminWindowLimit', '可管理群数量上限（0 不限）']] as const).map(([k, label]) => (
                <div key={k}>
                  <div className="small" style={{ marginBottom: 4 }}>{label}（0=不限）</div>
                  <input className="input" type="number" value={String(num(k) ?? 0)} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} />
                </div>
              ))}
            </div>
            {!!editId && (planUsage[editId] ?? 0) > 0 && (
              <div className="small" style={{ marginTop: 10, color: '#B45309', background: '#FFFBEB', padding: '8px 10px', borderRadius: 6 }}>
                ⚠️ 影响面警示：该套餐正被 {planUsage[editId]} 个在用租户使用，修改即时生效并写入审计（需正反向验证）
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <AsyncButton closeDialog className="btn btn-secondary" onClick={() => setShowEdit(false)}>取消</AsyncButton>
              <AsyncButton className="btn btn-primary" onClick={save}>保存（即时生效）</AsyncButton>
            </div>
          </div>
        </ModalFrame>
      )}
    </PageData></>
  );
}
