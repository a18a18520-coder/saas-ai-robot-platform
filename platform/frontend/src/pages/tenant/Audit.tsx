import { PageData, AsyncButton, ModalFrame } from '../../components/Interaction';
import { useEffect, useState } from 'react';
import { api, CURRENT_TENANT_ID } from '../../api/client';
import { fmtDateTime, fmtMDHM, todayStamp } from '../../api/datetime';

const TID = CURRENT_TENANT_ID;

interface AuditRow {
  id: string;
  robotId?: string;
  channelUserId?: string;
  question: string;
  answer?: string;
  datasetHits?: Array<{ content: string }>;
  toolCalls?: unknown[];
  traceId?: string;
  durationMs: number;
  result: string;
  stages?: Array<{ name: string; durationMs: number; result: string }>;
  createdAt: string;
}

export default function Audit() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [robots, setRobots] = useState<Array<{ id: string; name: string }>>([]);
  const [result, setResult] = useState('');
  const [keyword, setKeyword] = useState('');
  const [robotId, setRobotId] = useState('');
  const [hours, setHours] = useState('');
  const [detail, setDetail] = useState<AuditRow | null>(null);
  // 审计统计（顶部概况：按日趋势 + 结果分布）
  const [stats, setStats] = useState<{ days: number; daily: Array<{ date: string; ai: number; hit: number; handoff: number; denied: number }>; dist: { total: number; hit: number; handoff: number; denied: number; insufficient: number; failed: number; tool: number; other: number } } | null>(null);

  const [pageLoad, setPageLoad] = useState({ loading: true, ready: false, error: '' });
  async function load() {
    setPageLoad(old => ({ ...old, loading: true, error: '' }));
    try {
    const q = new URLSearchParams({ tenantId: TID });
    if (result) q.set('result', result);
    if (keyword) q.set('keyword', keyword);
    if (robotId) q.set('robotId', robotId);
    if (hours) q.set('hours', hours);
    setRows(await api<AuditRow[]>(`/api/v1/tenant/audit?${q}`));

      setPageLoad({ loading: false, ready: true, error: '' });
    } catch (cause) { setPageLoad(old => ({ ...old, loading: false, error: (cause as Error).message })); }
  }
  useEffect(() => { load().catch(() => {}); }, [result, keyword, robotId, hours]);
  useEffect(() => { api<Array<{ id: string; name: string }>>(`/api/v1/tenant/robots?tenantId=${TID}`).then(setRobots).catch(() => {}); }, []);
  useEffect(() => { api(`/api/v1/tenant/audit/stats?tenantId=${TID}&days=14`).then((d) => setStats(d as never)).catch(() => {}); }, []);

  const robotName = (rid?: string) => (rid ? (robots.find((r) => r.id === rid)?.name ?? rid.slice(0, 8)) : '—');
  const badge = (r: string) =>
    r.includes('命中') && !r.includes('未命中') ? 'badge-success' : r.includes('人工') ? 'badge-error' : r.includes('权限') ? 'badge-error' : r.includes('工具') ? 'badge-info' : 'badge-neutral';

  function exportCsv() {
    const head = '时间,机器人,用户,问题,命中内容,结果,耗时ms,TraceID\n';
    const body = rows.map((r) => [
      fmtDateTime(r.createdAt),
      robotName(r.robotId),
      r.channelUserId ?? '—',
      `"${(r.question ?? '').replace(/"/g, '""')}"`,
      `"${(r.datasetHits?.[0]?.content ?? '').slice(0, 50).replace(/"/g, '""')}"`,
      r.result,
      r.durationMs,
      r.traceId ?? '',
    ].join(',')).join('\n');
    const blob = new Blob(['﻿' + head + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `audit-${todayStamp()}.csv`;
    a.click();
  }

  return (
    <><PageData state={pageLoad} onRetry={load}>
      <div className="page-header">
        <div>
          <h1>审计中心</h1>
          <div className="desc">全链路调用审计：谁问 / 问什么 / 用什么知识 / 调什么接口 / 返回什么（FR-015 真实埋点）</div>
        </div>
        <AsyncButton className="btn btn-secondary" onClick={exportCsv}>⬇ 导出 CSV</AsyncButton>
      </div>

      {/* 审计统计概况（近 14 日：AI 调用趋势 + 结果分布） */}
      {stats && (
        <>
          <div className="metrics" style={{ marginBottom: 14 }}>
            <div className="metric"><div className="m-label">💬 AI 调用</div><div className="m-value">{stats.dist.total}</div><div className="m-sub">近 {stats.days} 日累计</div></div>
            <div className="metric"><div className="m-label">🎯 知识命中率</div><div className="m-value">{stats.dist.total ? Math.round((stats.dist.hit / stats.dist.total) * 100) : 0}%</div><div className="m-sub">{stats.dist.hit} 次知识命中</div></div>
            <div className="metric"><div className="m-label">🤝 转人工</div><div className="m-value">{stats.dist.handoff}</div><div className="m-sub">实际创建的待跟进记录</div></div>
            <div className="metric"><div className="m-label">🚫 请求拒绝</div><div className="m-value">{stats.dist.denied}</div><div className="m-sub">权限或额度拦截</div></div>
          </div>

          <div className="card" style={{ marginBottom: 14, padding: '18px 20px' }}>
            <div className="card-title" style={{ fontSize: 14, marginBottom: 4 }}>对话趋势（近 {stats.days} 日）</div>
            <div className="small muted" style={{ marginBottom: 10 }}>蓝线 = AI 调用量 · 红虚线 = 转人工量</div>
            <AuditTrendChart trend={stats.daily} />
            <div style={{ display: 'flex', gap: 24, marginTop: 10, fontSize: 12, flexWrap: 'wrap' }}>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: '#3B82F6', marginRight: 5 }} />知识命中 {stats.dist.hit}</span>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: '#F59E0B', marginRight: 5 }} />证据不足 {stats.dist.insufficient}</span>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: '#EF4444', marginRight: 5 }} />请求拒绝 {stats.dist.denied}</span>
            </div>
            <div className="small muted" style={{ marginTop: 8 }}>回答失败 {stats.dist.failed} · 工具调用 {stats.dist.tool} · 其他 {stats.dist.other}。转人工单独按待跟进创建记录统计，不与回答结果相加。</div>
            {stats.dist.total > 0 && (
              <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 8 }}>
                <div style={{ width: `${(stats.dist.hit / stats.dist.total) * 100}%`, background: '#3B82F6' }} />
                <div style={{ width: `${(stats.dist.insufficient / stats.dist.total) * 100}%`, background: '#F59E0B' }} />
                <div style={{ width: `${(stats.dist.denied / stats.dist.total) * 100}%`, background: '#EF4444' }} />
              </div>
            )}
          </div>
        </>
      )}

      {/* 筛选栏（对齐原型：搜索/机器人/结果/时间） */}
      <div className="flex gap-3" style={{ marginBottom: 12 }}>
        <input className="input" style={{ width: 180 }} placeholder="搜索用户/问题…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        <select className="select" value={robotId} onChange={(e) => setRobotId(e.target.value)}>
          <option value="">全部机器人</option>
          {robots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select className="select" value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="">全部结果</option>
          <option value="知识命中">知识命中</option>
          <option value="未命中转人工">人工介入</option>
          <option value="权限拒绝">权限拒绝</option>
          <option value="证据不足">证据不足</option>
          <option value="生成失败">生成失败</option>
          <option value="检索服务失败">检索服务失败</option>
          <option value="额度拒绝">额度拒绝</option>
          <option value="工具调用">工具调用</option>
        </select>
        <select className="select" value={hours} onChange={(e) => setHours(e.target.value)}>
          <option value="">全部时间</option>
          <option value="24">最近 24 小时</option>
          <option value="168">最近 7 天</option>
          <option value="720">最近 30 天</option>
        </select>
        <span className="small muted" style={{ alignSelf: 'center' }}>{rows.length} 条</span>
      </div>

      <div className="card">
        <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
          <thead><tr><th>时间</th><th>机器人</th><th>用户</th><th>问题</th><th>命中内容</th><th>结果</th><th>工具</th><th>Trace ID</th><th>操作</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted small">{fmtMDHM(r.createdAt || '')}</td>
                <td className="small">{robotName(r.robotId)}</td>
                <td className="muted small">{r.channelUserId?.slice(0, 10) ?? '—'}</td>
                <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.question}</td>
                <td className="muted small" style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.datasetHits?.[0]?.content?.slice(0, 30) ?? '—'}
                </td>
                <td><span className={`badge ${badge(r.result)}`}>{r.result}</span></td>
                <td className="muted small">{r.toolCalls?.length ? `${r.toolCalls.length} 次` : '—'}</td>
                <td className="muted small" style={{ fontFamily: 'monospace' }}>{r.traceId?.slice(0, 10) ?? '—'}</td>
                <td><AsyncButton className="link" onClick={() => setDetail(r)}>详情</AsyncButton></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 32 }}>暂无审计记录（发一条消息触发）</td></tr>}
          </tbody>
        </table></div>
      </div>

      {/* 详情 Modal */}
      {detail && (
        <ModalFrame title="审计详情" onClose={() => { setDetail(null); }} drawer>
          <div className="card" style={{ width: 520, maxWidth: '94vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="card-title">审计详情</div>
              <AsyncButton closeDialog style={{ cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)' }} onClick={() => setDetail(null)}>✕</AsyncButton>
            </div>
            <table style={{ width: '100%', fontSize: 13 }}>
              <tbody>
                {[
                  ['时间', fmtDateTime(detail.createdAt || '')],
                  ['机器人', robotName(detail.robotId)],
                  ['用户', detail.channelUserId ?? '—'],
                  ['问题', detail.question],
                  ['结果', detail.result],
                  ['耗时', detail.durationMs ? `${detail.durationMs}ms` : '—'],
                  ['Trace ID', detail.traceId ?? '—'],
                  ['命中切片', detail.datasetHits?.length
                    ? detail.datasetHits.map((h, i) => `(${i + 1}) ${(h as { content?: string }).content ?? ''}`).join('\n')
                    : '—'],
                  ['回答', detail.answer ?? '—'],
                ].map(([k, v]) => (
                  <tr key={k} style={{ verticalAlign: 'top' }}>
                    <td className="muted small" style={{ width: 90, padding: '6px 8px' }}>{k}</td>
                    <td className="small" style={{ padding: '6px 8px', wordBreak: 'break-all' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* 链路明细（对齐原型 audit-detail.html） */}
            {(detail.stages?.length ?? 0) > 0 && (
              <>
                <div className="card-sub" style={{ margin: '14px 0 8px' }}>链路明细</div>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-hover)' }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>阶段</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>耗时</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>结果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.stages?.map((s, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--border-light)' }}>
                        <td style={{ padding: '5px 8px', fontWeight: 500 }}>
                          {['身份解析', '权限计算', '知识检索', '判定'].includes(s.name) ? `${['①', '②', '③', '④'][i] ?? ''} ${s.name}` : s.name}
                        </td>
                        <td style={{ padding: '5px 8px' }} className="muted">{s.durationMs}ms</td>
                        <td style={{ padding: '5px 8px' }} className="small">{s.result}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </ModalFrame>
      )}
    </PageData></>
  );
}

/** 审计对话趋势图（文件级组件：AI 调用蓝线 + 转人工红虚线，对齐 dashboard 视觉） */
function AuditTrendChart({ trend }: { trend: Array<{ date: string; ai: number; handoff: number }> }) {
  const W = 720, H = 200, PAD = 40, TOP = 20, BOTTOM = 180;
  const max = Math.max(1, ...trend.map((t) => Math.max(t.ai, t.handoff)));
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(1, trend.length - 1);
  const y = (v: number) => BOTTOM - (v / max) * (BOTTOM - TOP);
  const line = (key: 'ai' | 'handoff') => trend.map((t, i) => `${i === 0 ? '' : ' '}${x(i)},${y(t[key])}`).join('');
  const area = (key: 'ai' | 'handoff') => `${line(key)} ${x(trend.length - 1)},${BOTTOM} ${PAD},${BOTTOM}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 200 }}>
      <g stroke="#EEF1F5">
        {[20, 70, 120, 170].map((yy) => <line key={yy} x1="0" y1={yy} x2={W} y2={yy} />)}
      </g>
      <polygon fill="rgba(59,130,246,.08)" points={area('ai')} />
      <polyline fill="none" stroke="#3B82F6" strokeWidth="2.5" points={line('ai')} />
      <polyline fill="none" stroke="#EF4444" strokeWidth="2" strokeDasharray="5,4" points={line('handoff')} />
    </svg>
  );
}
