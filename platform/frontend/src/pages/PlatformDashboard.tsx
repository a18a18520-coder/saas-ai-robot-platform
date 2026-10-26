import { Modal, AsyncButton } from '../components/Interaction';
import { useEffect, useState } from 'react';
import TenantDetail from './TenantDetail';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

interface Stats {
  tenants: { total: number; active: number; disabled: number; pending: number; thisMonth: number };
  todayCalls: number;
  p95Ms: number | null;
  trend7d: Array<{ date: string; ai: number; handoff: number }>;
  planDistribution: Record<string, number>;
  channelDistribution: Record<string, number>;
  tenantUsage: Array<{ tenantId: string; tenantName: string; planName: string; monthCalls: number; quotaUsedPct: number; robotCount: number; status: string; overQuota: boolean; alertLevel?: 'REMINDER' | 'STRONG' }>;
  revenue: { monthTotal: number; monthTotalYuan: number; daily: Array<{ date: string; amount: number }> } | null;
}

function TrendChart({ trend }: { trend: Array<{ date: string; ai: number; handoff: number }> }) {
  const W = 720, H = 200, PAD = 40, TOP = 20, BOTTOM = 180;
  const max = Math.max(1, ...trend.map((t) => Math.max(t.ai, t.handoff)));
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(1, trend.length - 1);
  const y = (v: number) => BOTTOM - (v / max) * (BOTTOM - TOP);
  const line = (key: 'ai' | 'handoff') => trend.map((t, i) => `${i === 0 ? '' : ' '}${x(i)},${y(t[key])}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 220 }}>
      <g stroke="#EEF1F5">{([20, 70, 120, 170]).map((yy) => <line key={yy} x1="0" y1={yy} x2={W} y2={yy} />)}</g>
      <polygon fill="rgba(59,130,246,.08)" points={`${line('ai')} ${x(trend.length - 1)},${BOTTOM} ${PAD},${BOTTOM}`} />
      <polyline fill="none" stroke="#3B82F6" strokeWidth="2.5" points={line('ai')} />
      <polyline fill="none" stroke="#EF4444" strokeWidth="2" strokeDasharray="5,4" points={line('handoff')} />
    </svg>
  );
}

export default function PlatformDashboard() {
  const nav = useNavigate();
  const [detailId, setDetailId] = useState('');
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    api<Stats>('/api/v1/admin/stats').then(setS).catch(() => {});
  }, []);

  const overQuota = (s?.tenantUsage ?? []).filter((u) => u.overQuota || u.alertLevel === 'STRONG').length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>平台工作台</h1>
          <div className="desc">SaaS 平台全局运营概览（真实数据）</div>
        </div>
      </div>
      <div className="metrics">
        <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }} className="metric" onClick={() => nav('/tenants')}>
          <div className="m-label">🏢 租户总数</div>
          <div className="m-value">{s?.tenants.total ?? '—'}</div>
          <div className="m-trend up">↑ {s?.tenants.thisMonth ?? 0} 本月新增</div>
          <div className="m-sub">{s?.tenants.active ?? 0} 启用 · {s?.tenants.disabled ?? 0} 禁用 · {s?.tenants.pending ?? 0} 待开通</div>
        </div>
        <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }} className="metric" onClick={() => nav('/audit')}>
          <div className="m-label">💬 AI 调用（今日）</div>
          <div className="m-value">{s?.todayCalls ?? '—'}</div>
          <div className="m-trend">{s?.p95Ms ? `P95 响应 ${(s.p95Ms / 1000).toFixed(2)}s` : '— 耗时未采集'}</div>
          <div className="m-sub">全平台实时埋点</div>
        </div>
        <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }} className="metric" onClick={() => nav('/payments')}>
          <div className="m-label">💰 月度收入</div>
          <div className="m-value">{s?.revenue ? `¥${s.revenue.monthTotalYuan.toLocaleString()}` : '—'}</div>
          <div className="m-sub">{s?.revenue ? '已支付订单合计（真实）' : '暂无支付记录'}</div>
        </div>
        <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }} className="metric" onClick={() => nav('/tenants')}>
          <div className="m-label">🔴 异常租户</div>
          <div className="m-value">{overQuota}</div>
          <div className="m-trend down">{overQuota ? '额度强提醒需关注' : '无强提醒'}</div>
          <div className="m-sub">按租户自定义强提醒阈值</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">全平台 AI 调用趋势</div>
            <div className="card-sub">近 7 日调用量（数据来源：审计中心）</div>
          </div>
        </div>
        {s?.trend7d?.length ? (
          <>
            <TrendChart trend={s.trend7d} />
            <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#3B82F6' }} /> AI 调用</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#EF4444' }} /> 转人工</span>
            </div>
          </>
        ) : (
          <div className="small muted" style={{ padding: 24, textAlign: 'center' }}>暂无调用数据</div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">租户用量排行</div>
            <div className="card-sub">本计费周期调用 / 额度使用 / 机器人（点击行进租户详情）</div>
          </div>
          <AsyncButton className="btn btn-secondary btn-sm" onClick={() => nav('/tenants')}>全部租户</AsyncButton>
        </div>
        <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
          <thead><tr><th>租户</th><th>套餐</th><th>本周期调用</th><th>额度使用</th><th>机器人</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {(s?.tenantUsage ?? []).map((u) => (
              <tr key={u.tenantId} className="row-link" style={{ cursor: 'pointer' }} onClick={() => setDetailId(u.tenantId)}>
                <td className="cell-strong">{u.tenantName}</td>
                <td className="muted">{u.planName}</td>
                <td>{u.monthCalls}</td>
                <td>
                  <span className={`badge ${u.overQuota || u.alertLevel === 'STRONG' ? 'badge-error' : u.alertLevel === 'REMINDER' ? 'badge-warning' : 'badge-success'}`}>
                    {u.quotaUsedPct}%
                  </span>
                </td>
                <td>{u.robotCount}</td>
                <td>
                  <span className={`badge ${u.status === 'ACTIVE' ? 'badge-success' : u.status === 'PENDING_ACTIVATION' ? 'badge-neutral' : 'badge-warning'}`}>
                    {u.status === 'ACTIVE' ? '启用' : u.status === 'PENDING_ACTIVATION' ? '待开通' : '禁用'}
                  </span>
                </td>
                <td onClick={(e) => e.stopPropagation()}><AsyncButton className="link" onClick={() => setDetailId(u.tenantId)}>详情</AsyncButton></td>
              </tr>
            ))}
            {!s?.tenantUsage?.length && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 24 }}>暂无租户</td></tr>}
          </tbody>
        </table></div>
      </div>
      {detailId && <Modal title="租户详情" drawer onClose={() => setDetailId('')}><TenantDetail tenantId={detailId} onClose={() => setDetailId('')} /></Modal>}
    </>
  );
}
