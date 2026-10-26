import { PageData, AsyncButton, ModalFrame } from '../components/Interaction';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { fmtDateTime, fmtMDHM, todayStamp } from '../api/datetime';

interface Row {
  id: string; tenantId?: string; tenantName?: string; channelUserId?: string;
  question: string; answer?: string; datasetHits?: Array<{ content: string }>;
  toolCalls?: unknown[]; traceId?: string; durationMs: number; result: string; createdAt: string;
}

/** 平台审计（FR-021）——全租户操作/调用检索（真实 API + 筛选） */
export default function PlatformAudit() {
  const [rows, setRows] = useState<Row[]>([]);
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);
  const [keyword, setKeyword] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [type, setType] = useState('');
  const [hours, setHours] = useState('');
  const [detail, setDetail] = useState<Row | null>(null);

  const [pageLoad, setPageLoad] = useState({ loading: true, ready: false, error: '' });
  async function load() {
    setPageLoad(old => ({ ...old, loading: true, error: '' }));
    try {
    const q = new URLSearchParams();
    if (keyword) q.set('keyword', keyword);
    if (tenantId) q.set('tenantId', tenantId);
    if (type) q.set('type', type);
    if (hours) q.set('hours', hours);
    const d = await api<{ list: Row[] }>('/api/v1/admin/audit?' + q);
    setRows(d.list ?? []);

      setPageLoad({ loading: false, ready: true, error: '' });
    } catch (cause) { setPageLoad(old => ({ ...old, loading: false, error: (cause as Error).message })); }
  }
  useEffect(() => { load().catch(() => {}); }, [keyword, tenantId, type, hours]);
  useEffect(() => { api<Array<{ id: string; name: string }>>('/api/v1/admin/tenants').then(setTenants).catch(() => {}); }, []);

  const badge = (r: string) =>
    r.includes('命中') ? 'badge-success' : r.includes('权限') ? 'badge-error' : r.includes('人工') ? 'badge-warning' : 'badge-neutral';

  /** 类型派生（platform-audit.html 类型列）：[模块] 前缀 = 平台/配置操作，其余按结果语义 */
  const typeOf = (r: Row) => {
    if (r.question?.startsWith('[')) return { label: '平台操作', cls: 'badge-info' };
    if (r.result?.includes('权限')) return { label: '越权异常', cls: 'badge-error' };
    if (r.result?.includes('额度') || r.question?.includes('额度')) return { label: '额度超限', cls: 'badge-warning' };
    return { label: '租户调用', cls: 'badge-neutral' };
  };
  const displayRows = type === 'PLATFORM' ? rows.filter((r) => typeOf(r).label === '平台操作') : rows;

  function exportCsv() {
    const head = '时间,租户,操作人,问题,命中内容,结果,耗时ms,TraceID\n';
    const body = rows.map((r) => [
      fmtDateTime(r.createdAt || ''),
      r.tenantName ?? '—',
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
    a.download = `platform-audit-${todayStamp()}.csv`;
    a.click();
  }

  return (
    <><PageData state={pageLoad} onRetry={load}>
      <div className="page-header">
        <div>
          <h1>平台审计</h1>
          <div className="desc">全租户操作与调用审计：平台操作 / 越权异常 / 额度超限</div>
        </div>
        <AsyncButton className="btn btn-secondary" onClick={exportCsv}>⬇ 导出 CSV</AsyncButton>
      </div>

      {/* 筛选栏（对齐原型） */}
      <div className="flex gap-3" style={{ marginBottom: 12 }}>
        <input className="input" style={{ width: 200 }} placeholder="搜索租户/关键词…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        <select className="select" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
          <option value="">全部租户</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">全部类型</option>
          <option value="PLATFORM">平台操作</option>
          <option value="TENANT_CALL">租户调用</option>
          <option value="SECURITY">越权异常</option>
          <option value="QUOTA">额度超限</option>
        </select>
        <select className="select" value={hours} onChange={(e) => setHours(e.target.value)}>
          <option value="">全部时间</option>
          <option value="168">最近 7 天</option>
          <option value="720">最近 30 天</option>
        </select>
        <span className="small muted" style={{ alignSelf: 'center' }}>{rows.length} 条</span>
      </div>

      <div className="card">
        <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
          <thead><tr><th>时间</th><th>类型</th><th>租户</th><th>操作人</th><th>问题</th><th>命中内容</th><th>结果</th><th>Trace ID</th><th>操作</th></tr></thead>
          <tbody>
            {displayRows.map((r) => (
              <tr key={r.id} style={r.result.includes('权限') ? { background: 'var(--error-bg)' } : {}}>
                <td className="muted small">{fmtMDHM(r.createdAt || '')}</td>
                <td><span className={`badge ${typeOf(r).cls}`}>{typeOf(r).label}</span></td>
                <td style={{ fontWeight: 500 }}>{r.tenantName ?? '—'}</td>
                <td className="muted small">{r.channelUserId?.slice(0, 10) ?? '—'}</td>
                <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.question}</td>
                <td className="muted small" style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.datasetHits?.[0]?.content?.slice(0, 30) ?? '—'}
                </td>
                <td><span className={`badge ${badge(r.result)}`}>{r.result}</span></td>
                <td className="muted small" style={{ fontFamily: 'monospace' }}>{r.traceId?.slice(0, 10) ?? '—'}</td>
                <td>
                  <AsyncButton className="link" onClick={() => setDetail(r)}>详情</AsyncButton>
                  {(r.result?.includes('额度') || r.question?.includes('额度')) && r.tenantId && (
                    <a className="link" style={{ marginLeft: 10 }} href={`#/tenants/${r.tenantId}`}>处理 →</a>
                  )}
                </td>
              </tr>
            ))}
            {displayRows.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 32 }}>暂无审计记录</td></tr>}
          </tbody>
        </table></div>
      </div>

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
                  ['租户', detail.tenantName ?? '—'],
                  ['操作人', detail.channelUserId ?? '—'],
                  ['问题', detail.question],
                  ['结果', detail.result],
                  ['耗时', detail.durationMs ? `${detail.durationMs}ms` : '—'],
                  ['Trace ID', detail.traceId ?? '—'],
                  ['命中切片', detail.datasetHits?.[0]?.content ?? '—'],
                  ['回答', detail.answer ?? '—'],
                ].map(([k, v]) => (
                  <tr key={k} style={{ verticalAlign: 'top' }}>
                    <td className="muted small" style={{ width: 80, padding: '6px 8px' }}>{k}</td>
                    <td className="small" style={{ padding: '6px 8px', wordBreak: 'break-all' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ModalFrame>
      )}
    </PageData></>
  );
}
