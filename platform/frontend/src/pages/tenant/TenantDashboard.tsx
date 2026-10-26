import { AsyncButton } from '../../components/Interaction';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, CURRENT_TENANT_ID } from '../../api/client';
import type { Robot } from '../../api/types';
import { fmtMDHM } from '../../api/datetime';

const TID = CURRENT_TENANT_ID;

interface AuditRow {
  id: string; time: string; robotName: string; user: string;
  question: string; hit: string | null; result: string; durationMs: number;
}
interface Stats {
  robots: { total: number; published: number };
  groups: { total: number; bound: number };
  users: number;
  sessions: number;
  knowledgeBases: number;
  followUpsPending: number;
  channels: number;
  robotsThisMonth: number;
  robotsDraft: number;
  todayCalls: number;
  p95Ms: number | null;
  trend7d: Array<{ date: string; ai: number; handoff: number }>;
  recentAudits: AuditRow[];
  followUpsToday: number;
  plan: {
    name: string;
    robotLimit: number; userLimit: number; kbLimit: number; channelLimit: number;
    fileSizeLimitMb: number;
    aiQuota: number; aiQuotaUsed: number;
    usage: { robots: number; users: number; knowledgeBases: number; channels: number };
  } | null;
}

/** 7 日趋势折线图（SVG，对齐原型 dashboard.html） */
function TrendChart({ trend }: { trend: Array<{ date: string; ai: number; handoff: number }> }) {
  const W = 720, H = 200, PAD = 40, TOP = 20, BOTTOM = 180;
  const max = Math.max(1, ...trend.map((t) => Math.max(t.ai, t.handoff)));
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(1, trend.length - 1);
  const y = (v: number) => BOTTOM - (v / max) * (BOTTOM - TOP);
  const line = (key: 'ai' | 'handoff') => trend.map((t, i) => `${i === 0 ? '' : ' '}${x(i)},${y(t[key])}`).join('');
  const area = (key: 'ai' | 'handoff') => `${line(key)} ${x(trend.length - 1)},${BOTTOM} ${PAD},${BOTTOM}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 220 }}>
      <g stroke="#EEF1F5">
        {[20, 70, 120, 170].map((yy) => <line key={yy} x1="0" y1={yy} x2={W} y2={yy} />)}
      </g>
      <polygon fill="rgba(59,130,246,.08)" points={area('ai')} />
      <polyline fill="none" stroke="#3B82F6" strokeWidth="2.5" points={line('ai')} />
      <polyline fill="none" stroke="#EF4444" strokeWidth="2" strokeDasharray="5,4" points={line('handoff')} />
    </svg>
  );
}

export default function TenantDashboard() {
  const nav = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [robots, setRobots] = useState<Robot[]>([]);

  useEffect(() => {
    api<Stats>(`/api/v1/tenant/stats?tenantId=${TID}`).then(setStats).catch(() => {});
    api<Robot[]>(`/api/v1/tenant/robots?tenantId=${TID}`).then(setRobots).catch(() => {});
  }, []);

  const s = stats;
  // 今日调用环比（trend7d 末两天对比；前日为 0 时无环比）
  const trend = s?.trend7d ?? [];
  const mom = trend.length >= 2 && trend[trend.length - 2].ai > 0
    ? `${((trend[trend.length - 1].ai - trend[trend.length - 2].ai) / trend[trend.length - 2].ai * 100).toFixed(1)}%`
    : null;
  const limit = (used: number, max: number) => (max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0);
  const resultBadge = (r: string) =>
    r.includes('命中') ? 'badge-success'
    : r.includes('人工') || r.includes('权限') ? 'badge-error'
    : r.includes('工具') ? 'badge-info'
    : 'badge-neutral';

  return (
    <>
      <div className="page-header">
        <div>
          <h1>工作台</h1>
          <div className="desc">租户运行概览：机器人、对话、知识库与人工介入</div>
        </div>
      </div>

      {/* 指标卡（对齐原型：机器人总数 / 今日 AI 调用 / 知识库文件 / 转人工事件） */}
      <div className="metrics">
        <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }} className="metric" onClick={() => nav('/t/robots')}>
          <div className="m-label">🤖 机器人总数</div>
          <div className="m-value">{s?.robots.total ?? '—'}</div>
          <div className="m-trend up">↑ {s?.robotsThisMonth ?? 0} 本月新增</div>
          <div className="m-sub">{s?.robots.published ?? 0} 已发布 · {s?.robotsDraft ?? 0} 草稿</div>
        </div>
        <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }} className="metric" onClick={() => nav('/t/audit')}>
          <div className="m-label">💬 今日 AI 调用</div>
          <div className="m-value">{s?.todayCalls ?? '—'}</div>
          <div className="m-trend up">{mom ? `↑ ${mom} 较昨日` : '— 无昨日基线'}</div>
          <div className="m-sub">{s?.p95Ms ? `P95 响应 ${(s.p95Ms / 1000).toFixed(2)}s` : '耗时未采集'} · 累计会话 {s?.sessions ?? 0}</div>
        </div>
        <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }} className="metric" onClick={() => nav('/t/knowledge')}>
          <div className="m-label">📚 知识库</div>
          <div className="m-value">{s?.knowledgeBases ?? '—'}</div>
          <div className="m-trend">— 文件库</div>
          <div className="m-sub">{s?.channels ?? 0} 渠道接入</div>
        </div>
        <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }} className="metric" onClick={() => nav('/t/follow-ups')}>
          <div className="m-label">🔴 转人工事件</div>
          <div className="m-value">{s?.followUpsPending ?? '—'}</div>
          <div className="m-trend down">↑ {s?.followUpsToday ?? 0} 今日新增</div>
          <div className="m-sub">{s?.followUpsPending ?? 0} 待跟进 · 自动通知客服</div>
        </div>
      </div>

      {/* 对话趋势（对齐原型：近 7 日 AI 对话量 + 转人工量） */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">对话趋势</div>
            <div className="card-sub">近 7 日 AI 对话量与转人工量</div>
          </div>
        </div>
        {s?.trend7d?.length ? (
          <>
            <TrendChart trend={s.trend7d} />
            <div className="chart-legend" style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              <span className="k"><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#3B82F6' }} /> AI 对话量</span>
              <span className="k"><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#EF4444' }} /> 转人工量</span>
              <span className="k muted">数据来源：审计中心</span>
            </div>
          </>
        ) : (
          <div className="small muted" style={{ padding: 24, textAlign: 'center' }}>暂无对话数据（消息对话后自动产生）</div>
        )}
      </div>

      {/* 最近审计记录（对齐原型：最新 5 条） */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">最近审计记录</div>
            <div className="card-sub">最新 5 条 AI 调用与人工介入</div>
          </div>
          <AsyncButton className="btn btn-secondary btn-sm" onClick={() => nav('/t/audit')}>查看全部</AsyncButton>
        </div>
        <div className="table-wrap">
          <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
            <thead><tr><th>时间</th><th>机器人</th><th>用户</th><th>问题</th><th>命中内容</th><th>结果</th></tr></thead>
            <tbody>
              {(s?.recentAudits ?? []).map((a) => (
                <tr key={a.id}>
                  <td className="cell-muted">{fmtMDHM(a.time).slice(0, 16)}</td>
                  <td className="cell-strong">{a.robotName}</td>
                  <td className="cell-muted">{a.user}</td>
                  <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.question}</td>
                  <td className="cell-muted" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.hit ?? `无命中 · ${(a.durationMs / 1000).toFixed(2)}s`}
                  </td>
                  <td><span className={`badge ${resultBadge(a.result)}`}>{a.result}</span></td>
                </tr>
              ))}
              {!s?.recentAudits?.length && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 24 }}>暂无审计记录</td></tr>
              )}
            </tbody>
          </table></div>
        </div>
      </div>

      {/* 套餐与额度 */}
      {s?.plan && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="card-title" style={{ margin: 0 }}>套餐与额度 — {s.plan.name}</div>
            <div className="small muted">AI 额度 {s.plan.aiQuotaUsed}/{s.plan.aiQuota > 0 ? s.plan.aiQuota : '∞'} · 单文件 ≤ 15 MB</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            {[
              { label: '机器人', used: s.plan.usage.robots, max: s.plan.robotLimit },
              { label: '用户', used: s.plan.usage.users, max: s.plan.userLimit },
              { label: '知识库', used: s.plan.usage.knowledgeBases, max: s.plan.kbLimit },
              { label: '渠道', used: s.plan.usage.channels, max: s.plan.channelLimit },
            ].map((it) => (
              <div key={it.label}>
                <div className="small" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>{it.label}</span>
                  <span className="muted">{it.used}/{it.max > 0 ? it.max : '∞'}</span>
                </div>
                <div style={{ height: 6, background: 'var(--bg-hover)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${limit(it.used, it.max)}%`, height: '100%', background: 'var(--primary)', borderRadius: 3 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title" style={{ marginBottom: 16 }}>机器人列表（实时）</div>
        <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
          <thead><tr><th>名称</th><th>类型</th><th>Dify App</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {robots.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{r.name}</td>
                <td>{r.type}</td>
                <td className="muted small">{r.difyAppId?.slice(0, 12)}…</td>
                <td><span className={`badge ${r.status === 'PUBLISHED' ? 'badge-success' : 'badge-neutral'}`}>{r.status === 'PUBLISHED' ? '已发布' : r.status}</span></td>
                <td><AsyncButton className="link" onClick={() => nav('/t/robots')}>管理 →</AsyncButton></td>
              </tr>
            ))}
            {robots.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 32 }}>暂无机器人</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  );
}
