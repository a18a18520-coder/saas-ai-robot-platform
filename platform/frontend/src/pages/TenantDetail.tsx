import { useFeedback, PageData, Feedback, usePageTab, TabBar, TabPanel, AsyncButton } from '../components/Interaction';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Plan } from '../api/client';
import { fmtDateTime, fmtDate } from '../api/datetime';
import LifecycleConfirm from '../components/LifecycleConfirm';
import ResetTenantPasswordDialog from '../components/ResetTenantPasswordDialog';

interface Detail {
  id: string; name: string; status: string; adminEmail: string; planId: string; planName: string;
  cycleStartAt: string; aiQuotaUsed: number; isTrial: boolean; disabledReason?: string; createdAt: string;
  plan?: { aiQuota: number } | null;
  resource: {
    robots: Array<{ id: string; name: string; status: string }>;
    robotCount: number; publishedRobots: number; draftRobots: number;
    userCount: number; kbCount: number; channelCount: number; monthCalls: number; quotaUsedPct: number;
  };
  logs: Array<{ id: string; time: string; operator: string; module: string; action: string; detail: string; traceId?: string }>;
}

// 例外：保留既有深链接，支持收藏和直接访问；列表入口使用抽屉。
export default function TenantDetail({ tenantId, onClose }: { tenantId?: string; onClose?: () => void } = {}) {
  const params = useParams();
  const id = tenantId ?? params.id ?? '';
  const nav = useNavigate();
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = usePageTab('overview', ["overview","usage","dify","logs"] as const, 'tenantTab');
  const [msg, setMsg] = useFeedback();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [targetPlan, setTargetPlan] = useState('');
  const [switching, setSwitching] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  // 生命周期确认弹窗（lifecycle.js 对齐）
  const [confirm, setConfirm] = useState<{ action: 'disable' | 'restore' | 'remove'; label: string } | null>(null);

  const [pageLoad, setPageLoad] = useState({ loading: true, ready: false, error: '' });
  async function load() {
    setPageLoad(old => ({ ...old, loading: true, error: '' }));
    try { setD(await api<Detail>(`/api/v1/admin/tenants/${id}`));
      setPageLoad({ loading: false, ready: true, error: '' });
    } catch (cause) { setPageLoad(old => ({ ...old, loading: false, error: (cause as Error).message })); }
  }
  useEffect(() => { load().catch(() => {}); }, [id]);
  useEffect(() => {
    api<Plan[]>('/api/v1/admin/plans').then((list) => {
      setPlans(list.filter((p) => p.isActive));
      if (d) setTargetPlan((t) => t || (list.find((p) => p.id !== d.planId && p.isActive)?.id ?? ''));
    }).catch(() => {});
  }, [d?.planId]);

  /** 切换套餐（平台侧 API-005）：真实补价 → 需补差生成待支付账单，免付直接切换 */
  async function changePlan() {
    if (!targetPlan) return;
    setSwitching(true);
    setMsg('');
    try {
      const r = await api<{ priceDiff: { diff: number; nextExpireAt: string; usedDays: number }; order?: { id: string; amount: number } }>(`/api/v1/admin/tenants/${id}/change-plan`, {
        method: 'POST',
        body: JSON.stringify({ planId: targetPlan, effectType: 'IMMEDIATE' }),
      });
      if (r.order) {
        setMsg(`💳 应补差价 ¥${r.priceDiff.diff.toFixed(2)}，账单已生成待支付（¥${(r.order.amount / 100).toFixed(2)}），支付确认后新套餐生效`);
      } else {
        setMsg(`✅ 已切换套餐，新周期至 ${r.priceDiff.nextExpireAt}（已用 ${r.priceDiff.usedDays} 天，免付切换）`);
      }
      load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); } finally { setSwitching(false); }
  }

  async function lifecycle(action: 'disable' | 'restore' | 'remove') {
    const label = { disable: '禁用', restore: '恢复', remove: '删除' }[action];
    try {
      const r = await api<{ ok?: boolean; impact?: { robots?: number; users?: number; auditLogs?: number } }>(`/api/v1/admin/tenants/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ verify: { positive: true, negative: true }, reason: `平台操作：${label}` }),
      });
      setMsg(`✅ ${label}完成（影响面：机器人 ${r.impact?.robots ?? '-'} · 用户 ${r.impact?.users ?? '-'} · 审计 ${r.impact?.auditLogs ?? '-'}）`);
      setConfirm(null);
      load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function resetAdminPassword(password: string) {
    const result = await api<{
      account: string;
      sessionsRevoked: true;
      mustChangePassword: true;
    }>(
      `/api/v1/admin/tenants/${id}/reset-admin-password`,
      {
        method: 'POST',
        body: JSON.stringify({ password }),
      },
    );
    setResettingPassword(false);
    setMsg(`✅ 已为租户管理员「${result.account}」设置临时密码，旧刷新会话已失效；下次登录必须修改密码`);
    await load();
  }

  return (
    <><PageData state={pageLoad} onRetry={load}>
      <div className="page-header">
        <div>
          {!onClose && <AsyncButton className="link" onClick={() => nav('/tenants')}>← 租户管理</AsyncButton>}
          <h1 style={{ marginTop: 4 }}>{d?.name ?? '租户详情'}</h1>
          <div className="desc">{d?.id} · {d?.adminEmail}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {d && d.status !== 'PENDING_ACTIVATION' && d.status !== 'DELETED' && (
            <AsyncButton
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setMsg('');
                setResettingPassword(true);
              }}
            >
              重置管理员密码
            </AsyncButton>
          )}
          {d?.status === 'ACTIVE' && <AsyncButton className="btn btn-secondary" onClick={() => setConfirm({ action: 'disable', label: '禁用' })}>禁用租户</AsyncButton>}
          {d?.status === 'DISABLED' && <AsyncButton className="btn btn-secondary" onClick={() => setConfirm({ action: 'restore', label: '恢复' })}>恢复租户</AsyncButton>}
          <AsyncButton className="btn btn-secondary" style={{ color: 'var(--error)' }} onClick={() => setConfirm({ action: 'remove', label: '删除' })}>删除租户</AsyncButton>
        </div>
      </div>

      {msg && <Feedback message={msg} />}

      {resettingPassword && d && (
        <ResetTenantPasswordDialog
          tenantName={d.name}
          account={d.adminEmail}
          onConfirm={resetAdminPassword}
          onCancel={() => setResettingPassword(false)}
        />
      )}

      {confirm && (
        <LifecycleConfirm
          title={`${confirm.label}租户 — ${d?.name ?? ''}`}
          description={confirm.action === 'disable'
            ? '禁用后该租户全部机器人停止响应、后台不可登录（数据保留）。'
            : confirm.action === 'restore'
              ? '恢复后机器人按原配置继续响应。'
              : '删除不可恢复：机器人、知识库映射与审计将级联清理。'}
          impacts={confirm.action === 'disable'
            ? ['该租户下全部机器人停止响应', '关联群消息不再消费', '管理员后台登录被拒绝']
            : confirm.action === 'restore'
              ? ['机器人恢复响应', '恢复动作写入审计']
              : ['机器人/知识库/渠道映射级联删除', '审计记录保留（FR-021 可查）', '删除动作写入审计（正反向验证）']}
          onConfirm={() => lifecycle(confirm.action)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* 摘要卡 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🏢</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{d?.name}
              <span className={`badge ${d?.status === 'ACTIVE' ? 'badge-success' : d?.status === 'DISABLED' ? 'badge-warning' : 'badge-neutral'}`} style={{ marginLeft: 8 }}>
                {d?.status === 'ACTIVE' ? '启用' : d?.status === 'DISABLED' ? '禁用' : '待开通'}
              </span>
              <span className="badge badge-info" style={{ marginLeft: 6 }}>{d?.planName}</span>
              <span className={`badge ${(d?.resource.quotaUsedPct ?? 0) > 80 ? 'badge-error' : 'badge-success'}`} style={{ marginLeft: 6 }}>额度 {d?.resource.quotaUsedPct}%</span>
            </div>
            <div className="small muted">ID {d?.id} · 开通 {fmtDate(d?.createdAt ?? '')} · 管理员 {d?.adminEmail} · {d?.isTrial ? '试用' : '正式'}</div>
            {d?.disabledReason && <div className="small" style={{ color: 'var(--error)' }}>禁用原因: {d.disabledReason}</div>}
          </div>
        </div>
      </div>

      <TabBar name="tenantTab" items={[["overview","租户概览"],["usage","用量账单"],["dify","Dify 资源"],["logs","操作日志"]] as const} value={tab} onChange={setTab} />

      <TabPanel name="tenantTab" id="overview" active={tab}><>
          <div className="metrics" style={{ marginBottom: 16 }}>
            <div className="metric"><div className="m-label">🤖 机器人</div><div className="m-value">{d?.resource.robotCount ?? '—'}</div><div className="m-sub">{d?.resource.publishedRobots ?? 0} 已发布 · {d?.resource.draftRobots ?? 0} 草稿</div></div>
            <div className="metric"><div className="m-label">👤 用户</div><div className="m-value">{d?.resource.userCount ?? '—'}</div><div className="m-sub">跨渠道统一身份</div></div>
            <div className="metric"><div className="m-label">📚 知识库</div><div className="m-value">{d?.resource.kbCount ?? '—'}</div><div className="m-sub">知识范围</div></div>
            <div className="metric"><div className="m-label">🔌 渠道</div><div className="m-value">{d?.resource.channelCount ?? '—'}</div><div className="m-sub">已接入</div></div>
          </div>
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>租户配置概览</div>
            <table style={{ fontSize: 13 }}>
              <tbody>
                {[
                  ['套餐', d?.planName ?? '—'],
                  ['AI 额度', `${d?.aiQuotaUsed ?? 0} / ${d?.plan?.aiQuota && d.plan.aiQuota > 0 ? d.plan.aiQuota : '∞'}`],
                  ['额度使用率', `${d?.resource.quotaUsedPct ?? 0}%`],
                  ['本周期调用', String(d?.resource.monthCalls ?? '—')],
                  ['套餐周期', d?.cycleStartAt ?? '—'],
                  ['管理人员', d?.adminEmail ?? '—'],
                ].map(([k, v]) => (
                  <tr key={k}><td className="muted" style={{ width: 110, padding: '6px 8px' }}>{k}</td><td style={{ padding: '6px 8px' }}>{v}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </></TabPanel>

      <TabPanel name="tenantTab" id="usage" active={tab}><>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title" style={{ marginBottom: 12 }}>本月用量</div>
            <div className="metrics">
              <div className="metric"><div className="m-label">💬 AI 调用</div><div className="m-value">{d?.resource.monthCalls ?? '—'}</div><div className="m-sub">本计费周期累计</div></div>
              <div className="metric"><div className="m-label">📊 额度使用</div><div className="m-value">{d?.resource.quotaUsedPct ?? 0}%</div><div className="m-sub">{d?.resource.monthCalls ?? 0} 调用</div></div>
            </div>
          </div>
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>切换套餐（平台代操作，30 天补价）</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="muted small">当前：{d?.planName}</span>
              <select
                className="input"
                style={{ maxWidth: 220 }}
                value={targetPlan}
                onChange={(e) => setTargetPlan(e.target.value)}
                disabled={switching || d?.status !== 'ACTIVE'}
              >
                <option value="">选择目标套餐…</option>
                {plans.filter((p) => p.id !== d?.planId).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}（¥{p.price}/周期）</option>
                ))}
              </select>
              <AsyncButton className="btn btn-primary" onClick={changePlan} disabled={!targetPlan || switching || d?.status !== 'ACTIVE'}>
                {switching ? '计算中…' : '切换套餐（立即生效）'}
              </AsyncButton>
            </div>
            <div className="small muted" style={{ marginTop: 8 }}>
              补价规则：应补差价 = 新套餐价 −（旧套餐价 ÷ 30 × 已用天数）；降级需当前套餐到期后；需补差时生成待支付账单，确认支付后生效。
            </div>
          </div>
        </></TabPanel>

      <TabPanel name="tenantTab" id="dify" active={tab}><div className="card">
          <div className="card-title" style={{ marginBottom: 12 }}>已分配 Dify 资源（机器人绑定）</div>
          <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
            <thead><tr><th>机器人</th><th>状态</th><th>知识候选池</th></tr></thead>
            <tbody>
              {(d?.resource.robots ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="cell-strong">{r.name}</td>
                  <td><span className={`badge ${r.status === 'PUBLISHED' ? 'badge-success' : 'badge-neutral'}`}>{r.status}</span></td>
                  <td className="muted small">{r.id.slice(0, 8)}…</td>
                </tr>
              ))}
              {!d?.resource.robots?.length && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 24 }}>暂无机器人</td></tr>}
            </tbody>
          </table></div>
        </div></TabPanel>

      <TabPanel name="tenantTab" id="logs" active={tab}><div className="card">
          <div className="card-title" style={{ marginBottom: 12 }}>操作日志（配置变更记录）</div>
          <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
            <thead><tr><th>时间</th><th>操作人</th><th>模块</th><th>操作</th><th>详情</th></tr></thead>
            <tbody>
              {(d?.logs ?? []).map((l) => (
                <tr key={l.id}>
                  <td className="muted small">{fmtDateTime(l.time)}</td>
                  <td className="small">{l.operator}</td>
                  <td><span className="badge badge-info">{l.module}</span></td>
                  <td className="small">{l.action}</td>
                  <td className="muted small" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.detail}</td>
                </tr>
              ))}
              {!d?.logs?.length && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 24 }}>暂无操作记录</td></tr>}
            </tbody>
          </table></div>
        </div></TabPanel>
    </PageData></>
  );
}
