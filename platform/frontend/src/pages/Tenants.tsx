import { useFeedback, PageData, Feedback, Modal, AsyncButton, ModalFrame } from '../components/Interaction';
import { useEffect, useState } from 'react';
import TenantDetail from './TenantDetail';
import { api } from '../api/client';
import type { Tenant } from '../api/client';
import LifecycleConfirm from '../components/LifecycleConfirm';
import InitialTenantCredentialsDialog from '../components/InitialTenantCredentialsDialog';

interface InitialCredentials {
  tenantName: string;
  account: string;
  password: string;
}

interface CreateTenantResult extends Tenant {
  initialCredentials: {
    account: string;
    password: string;
    mustChangePassword: true;
  };
}

export default function Tenants() {
  const [detailId, setDetailId] = useState('');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [planId, setPlanId] = useState('');
  const [effectType, setEffectType] = useState<'IMMEDIATE' | 'TRIAL'>('IMMEDIATE');
  const [plans, setPlans] = useState<Array<{ id: string; name: string; price: number; validityDays: number }>>([]);
  const [msg, setMsg] = useFeedback();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [initialCredentials, setInitialCredentials] =
    useState<InitialCredentials | null>(null);

  const [pageLoad, setPageLoad] = useState({ loading: true, ready: false, error: '' });
  async function load() {
    setPageLoad(old => ({ ...old, loading: true, error: '' }));
    try {
    setTenants(await api<Tenant[]>('/api/v1/admin/tenants'));
    const d = await api<Array<{ id: string; name: string; price: number; validityDays: number }>>('/api/v1/admin/plans');
    const list = Array.isArray(d) ? d : (d as { list: typeof d }).list ?? [];
    setPlans(list);
    if (list.length && !planId) setPlanId(list[0].id);

      setPageLoad({ loading: false, ready: true, error: '' });
    } catch (cause) { setPageLoad(old => ({ ...old, loading: false, error: (cause as Error).message })); }
  }
  useEffect(() => { load().catch(() => {}); }, []);

  const filtered = tenants.filter((t) =>
    (!keyword || t.name.includes(keyword) || t.id.toLowerCase().includes(keyword.toLowerCase())) &&
    (!statusFilter || t.status === statusFilter) &&
    (!planFilter || t.planId === planFilter));

  async function create() {
    if (!name.trim() || !email.trim() || !planId) { setMsg('❌ 租户名称/管理员账号/套餐必填'); return; }
    setCreating(true);
    setMsg('');
    try {
      const result = await api<CreateTenantResult>('/api/v1/admin/tenants', {
        method: 'POST',
        body: JSON.stringify({ name, adminEmail: email, planId, trial: effectType === 'TRIAL' }),
      });
      setInitialCredentials({
        tenantName: result.name,
        account: result.initialCredentials.account,
        password: result.initialCredentials.password,
      });
      setMsg(`✅ 已开通「${result.name}」${effectType === 'TRIAL' ? '（试用）' : ''}，主管理员账号已启用`);
      setShowCreate(false); setName(''); setEmail('');
      void load().catch(() =>
        setMsg(`⚠️ 「${result.name}」已成功开通，但列表刷新失败，请稍后手动刷新`),
      );
    } catch (e) {
      setMsg('❌ ' + (e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function lifecycle(id: string, action: 'disable' | 'restore') {
    try {
      await api(`/api/v1/admin/tenants/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ verify: { positive: true, negative: true } }),
      });
      setMsg(`✅ ${action === 'disable' ? '已禁用' : '已恢复'}（正反向验证通过，已写审计）`);
      setConfirm(null);
      load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  // 生命周期确认弹窗状态（lifecycle.js 对齐）
  const [confirm, setConfirm] = useState<{ id: string; action: 'disable' | 'restore'; name: string } | null>(null);

  return (
    <><PageData state={pageLoad} onRetry={load}>
      <div className="page-header">
        <div>
          <h1>租户管理</h1>
          <div className="desc">SaaS 平台所有租户：开通、套餐、用量、生命周期管理（平台管理中心 §1.1）</div>
        </div>
        <AsyncButton className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>+ 开通新租户</AsyncButton>
      </div>

      {showCreate && (
        <ModalFrame title="开通新租户" onClose={() => { setShowCreate(false); }}>
          <div className="card" style={{ width: 520, maxWidth: '94vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div className="card-title">开通新租户</div>
              <AsyncButton closeDialog style={{ cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)' }} onClick={() => setShowCreate(false)}>✕</AsyncButton>
            </div>
            <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>租户名称 *</div>
            <input className="input" style={{ width: '100%', marginBottom: 12 }} placeholder="如 演示科技" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>租户管理员账号 *</div>
            <input className="input" style={{ width: '100%', marginBottom: 12 }} placeholder="admin@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>初始套餐 *</div>
            <select className="select" style={{ width: '100%', marginBottom: 12 }} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}（¥{p.price}/{p.validityDays}天）</option>)}
            </select>
            <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>生效方式</div>
            <div style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
              {([['IMMEDIATE', '立即生效（30 天周期）'], ['TRIAL', '试用 14 天']] as const).map(([v, label]) => (
                <label key={v} className="flex gap-3" style={{ gap: 5, fontSize: 13, cursor: 'pointer' }}>
                  <input type="radio" checked={effectType === v} onChange={() => setEffectType(v)} style={{ accentColor: 'var(--primary)' }} /> {label}
                </label>
              ))}
            </div>
            <div className="small muted" style={{ marginBottom: 14 }}>创建后立即生成主管理员账号和一次性临时密码，无需邮件激活。</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <AsyncButton closeDialog className="btn btn-secondary" disabled={creating} onClick={() => setShowCreate(false)}>取消</AsyncButton>
              <AsyncButton className="btn btn-primary" disabled={creating} onClick={create}>{creating ? '创建中…' : '创建租户'}</AsyncButton>
            </div>
          </div>
        </ModalFrame>
      )}

      {msg && <Feedback message={msg} />}

      <div className="flex gap-3" style={{ marginBottom: 12 }}>
        <input className="input" style={{ width: 220 }} placeholder="搜索租户名称 / ID…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">全部状态</option>
          <option value="ACTIVE">启用</option>
          <option value="DISABLED">禁用</option>
          <option value="PENDING_ACTIVATION">待开通</option>
        </select>
        <select className="select" value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
          <option value="">全部套餐</option>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="small muted" style={{ alignSelf: 'center' }}>{filtered.length} / {tenants.length} 个租户</span>
      </div>

      <div className="card">
        <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
          <thead>
            <tr><th>租户</th><th>套餐</th><th>机器人</th><th>用户</th><th>知识库</th><th>本周期调用/额度</th><th>状态</th><th>开通日期</th><th>操作</th></tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id} onClick={() => setDetailId(t.id)} style={{ cursor: 'pointer' }}>
                <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                  {t.name}
                  <div className="small muted">{t.id.slice(0, 8)}… · {t.adminEmail}</div>
                </td>
                <td><span className="badge badge-info">{(t as unknown as { planName?: string }).planName ?? '—'}</span></td>
                <td>{(t as unknown as { robotCount?: number }).robotCount ?? '—'}</td>
                <td>{(t as unknown as { userCount?: number }).userCount ?? '—'}</td>
                <td>{(t as unknown as { kbCount?: number }).kbCount ?? '—'}</td>
                <td>
                  <span className="muted">{(t as unknown as { monthCalls?: number }).monthCalls ?? '—'} 次</span>
                  <span className={`badge ${t.quotaAlertLevel === 'STRONG' ? 'badge-error' : t.quotaAlertLevel === 'REMINDER' ? 'badge-warning' : 'badge-success'}`} style={{ marginLeft: 6 }}>
                    {(t as unknown as { quotaUsedPct?: number }).quotaUsedPct ?? 0}%
                  </span>
                </td>
                <td>
                  <span className={`badge ${t.status === 'ACTIVE' ? 'badge-success' : t.status === 'PENDING_ACTIVATION' ? 'badge-neutral' : 'badge-warning'}`}>
                    {t.status === 'ACTIVE' ? '启用' : t.status === 'PENDING_ACTIVATION' ? '待开通' : '禁用'}
                  </span>
                </td>
                <td className="muted">{t.createdAt?.slice(0, 10)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <AsyncButton className="link" onClick={() => setDetailId(t.id)}>详情</AsyncButton>
                  {t.status === 'ACTIVE' ? (
                    <AsyncButton className="link" style={{ marginLeft: 12 }} onClick={() => setConfirm({ id: t.id, action: 'disable', name: t.name })}>禁用</AsyncButton>
                  ) : (
                    <AsyncButton className="link" style={{ marginLeft: 12 }} onClick={() => setConfirm({ id: t.id, action: 'restore', name: t.name })}>恢复</AsyncButton>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 32 }}>{tenants.length ? '无匹配租户' : '暂无租户'}</td></tr>
            )}
          </tbody>
        </table></div>
      </div>

      {confirm && (
        <LifecycleConfirm
          title={confirm.action === 'disable' ? `禁用租户 — ${confirm.name}` : `恢复租户 — ${confirm.name}`}
          description={confirm.action === 'disable' ? '禁用后该租户全部机器人停止响应、后台不可登录（数据保留，可恢复）。' : '恢复后该租户机器人按原配置继续响应，管理员可正常登录。'}
          impacts={confirm.action === 'disable'
            ? ['该租户下全部机器人停止响应', '关联群消息不再消费（@机器人无效）', '用户与配置数据保留，可随时恢复']
            : ['机器人按原配置恢复响应', '群消息处理恢复（仍仅 @机器人 消费）', '恢复动作写入审计']}
          onConfirm={() => lifecycle(confirm.id, confirm.action)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {initialCredentials && (
        <InitialTenantCredentialsDialog
          tenantName={initialCredentials.tenantName}
          account={initialCredentials.account}
          password={initialCredentials.password}
          onClose={() => setInitialCredentials(null)}
        />
      )}
      {detailId && <Modal title="租户详情" drawer onClose={() => setDetailId('')}><TenantDetail tenantId={detailId} onClose={() => { setDetailId(''); void load(); } } /></Modal>}
    </PageData></>
  );
}
