import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface Stats {
  tenants: { total: number; active: number; disabled: number; pending: number; thisMonth: number };
  tenantGrowth: Array<{ date: string; count: number }>;
  todayCalls: number;
  p95Ms: number | null;
  trend7d: Array<{ date: string; ai: number; handoff: number }>;
  planDistribution: Record<string, number>;
  channelDistribution: Record<string, number>;
  revenue: { monthTotal: number; monthTotalYuan: number; daily: Array<{ date: string; amount: number }> } | null;
}

/** 租户增长趋势折线（近 30 天新增累计） */
function GrowthChart({ growth }: { growth: Array<{ date: string; count: number }> }) {
  const W = 720, H = 200, PAD = 40, TOP = 20, BOTTOM = 180;
  const max = Math.max(1, ...growth.map((g) => g.count));
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(1, growth.length - 1);
  const y = (v: number) => BOTTOM - (v / max) * (BOTTOM - TOP);
  const line = growth.map((g, i) => `${i === 0 ? '' : ' '}${x(i)},${y(g.count)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 220 }}>
      <g stroke="#EEF1F5">{([20, 70, 120, 170]).map((yy) => <line key={yy} x1="0" y1={yy} x2={W} y2={yy} />)}</g>
      <polygon fill="rgba(59,130,246,.08)" points={`${line} ${x(growth.length - 1)},${BOTTOM} ${PAD},${BOTTOM}`} />
      <polyline fill="none" stroke="#3B82F6" strokeWidth="2.5" points={line} />
    </svg>
  );
}

/** 月度收入趋势折线（近 30 天每日已支付金额，真实支付数据，platform-stats.html 收入卡） */
function RevenueChart({ daily }: { daily: Array<{ date: string; amount: number }> }) {
  const W = 720, H = 200, PAD = 40, TOP = 20, BOTTOM = 180;
  const max = Math.max(1, ...daily.map((d) => d.amount));
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(1, daily.length - 1);
  const y = (v: number) => BOTTOM - (v / max) * (BOTTOM - TOP);
  const line = daily.map((d, i) => `${i === 0 ? '' : ' '}${x(i)},${y(d.amount)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 220 }}>
      <g stroke="#EEF1F5">{([20, 70, 120, 170]).map((yy) => <line key={yy} x1="0" y1={yy} x2={W} y2={yy} />)}</g>
      <polygon fill="rgba(16,185,129,.08)" points={`${line} ${x(daily.length - 1)},${BOTTOM} ${PAD},${BOTTOM}`} />
      <polyline fill="none" stroke="#10B981" strokeWidth="2.5" points={line} />
    </svg>
  );
}

const CHANNEL_NAME: Record<string, string> = { wecom: '企业微信', dingtalk: '钉钉', feishu: '飞书', web: 'Web 聊天' };

/** 平台统计 —— 租户/套餐/渠道/调用趋势（真实数据，对齐原型 platform-stats.html） */
export default function PlatformStats() {
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    api<Stats>('/api/v1/admin/stats').then(setS).catch(() => {});
  }, []);

  const planTotal = Object.values(s?.planDistribution ?? {}).reduce((a, b) => a + b, 0) || 1;
  const chanTotal = Object.values(s?.channelDistribution ?? {}).reduce((a, b) => a + b, 0) || 1;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>平台统计</h1>
          <div className="desc">租户、套餐、渠道、调用趋势（真实数据）</div>
        </div>
      </div>
      <div className="metrics">
        <div className="metric"><div className="m-label">租户总数</div><div className="m-value">{s?.tenants.total ?? '—'}</div><div className="m-sub">↑ {s?.tenants.thisMonth ?? 0} 本月新增</div></div>
        <div className="metric"><div className="m-label">月度收入</div><div className="m-value">{s?.revenue ? `¥${s.revenue.monthTotalYuan.toLocaleString()}` : '—'}</div><div className="m-sub">{s?.revenue ? '已支付订单合计' : '暂无支付记录'}</div></div>
        <div className="metric"><div className="m-label">全平台调用（今日）</div><div className="m-value">{s?.todayCalls ?? '—'}</div><div className="m-sub">{s?.p95Ms ? `P95 ${(s.p95Ms / 1000).toFixed(2)}s` : '耗时未采集'}</div></div>
        <div className="metric"><div className="m-label">启用租户</div><div className="m-value">{s?.tenants.active ?? '—'}</div><div className="m-sub">{s?.tenants.pending ?? 0} 待开通</div></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>租户增长趋势</div>
        <div className="card-sub" style={{ marginBottom: 8 }}>近 30 天新增租户累计</div>
        {s?.tenantGrowth?.length ? <GrowthChart growth={s.tenantGrowth} /> : <div className="small muted" style={{ padding: 24, textAlign: 'center' }}>暂无数据</div>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>月度收入趋势</div>
        <div className="card-sub" style={{ marginBottom: 8 }}>近 30 天每日已支付金额（元 · 真实支付订单）</div>
        {s?.revenue?.daily?.some((d) => d.amount > 0) ? <RevenueChart daily={s.revenue.daily} /> : <div className="small muted" style={{ padding: 24, textAlign: 'center' }}>暂无支付记录</div>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 16 }}>套餐分布</div>
        {Object.entries(s?.planDistribution ?? {}).map(([name, count]) => (
          <div key={name} style={{ marginBottom: 12 }}>
            <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <span>{name}</span><span className="muted">{count} 租户</span>
            </div>
            <div style={{ height: 8, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${Math.round((count / planTotal) * 100)}%`, height: '100%', background: 'var(--primary)', borderRadius: 4 }} />
            </div>
          </div>
        ))}
        {!Object.keys(s?.planDistribution ?? {}).length && <div className="small muted">暂无套餐数据</div>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 16 }}>渠道接入分布（按群归属渠道）</div>
        {Object.entries(s?.channelDistribution ?? {}).map(([ch, count]) => (
          <div key={ch} style={{ marginBottom: 12 }}>
            <div className="flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <span>{CHANNEL_NAME[ch] ?? ch}</span><span className="muted">{count} 群</span>
            </div>
            <div style={{ height: 8, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${Math.round((count / chanTotal) * 100)}%`, height: '100%', background: 'var(--primary)', borderRadius: 4 }} />
            </div>
          </div>
        ))}
        {!Object.keys(s?.channelDistribution ?? {}).length && <div className="small muted">暂无渠道数据</div>}
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: 12 }}>近 7 日调用趋势</div>
        <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
          <thead><tr><th>日期</th><th>AI 调用</th><th>转人工</th><th>合计</th></tr></thead>
          <tbody>
            {(s?.trend7d ?? []).map((t) => (
              <tr key={t.date}>
                <td className="muted">{t.date.slice(5)}</td>
                <td>{t.ai}</td>
                <td>{t.handoff}</td>
                <td>{t.ai + t.handoff}</td>
              </tr>
            ))}
            {!s?.trend7d?.length && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 24 }}>暂无数据</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  );
}
