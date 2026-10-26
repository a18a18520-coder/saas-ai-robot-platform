import { AsyncButton, PageData } from '../../components/Interaction';
import { useEffect, useState } from 'react';
import { api, CURRENT_TENANT_ID } from '../../api/client';
import { fmtDateTime, todayStamp } from '../../api/datetime';

const TID = CURRENT_TENANT_ID;

/** 行结构与后端 AuditLog 对齐：operator/detail 后端不返回（渲染走兜底），module/action 由 question 派生 */
interface LogRow { id: string; question: string; operator?: string; detail?: string; result?: string; traceId?: string; createdAt: string }

const MODULES = ['设置', '渠道', '群发', '机器人', '知识库', '角色', '权限'];

/** 操作日志（对齐原型 tenant-logs.html）：配置变更记录（谁在何时改了什么） */
export default function Logs() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [keyword, setKeyword] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [pageLoad, setPageLoad] = useState({ loading: true, ready: false, error: '' });

  async function load() {
    setPageLoad(old => ({ ...old, loading: true, error: '' }));
    try {
      setRows(await api<LogRow[]>('/api/v1/tenant/logs?tenantId=' + TID));
      setPageLoad({ loading: false, ready: true, error: '' });
    } catch (cause) { setPageLoad(old => ({ ...old, loading: false, error: (cause as Error).message })); }
  }
  useEffect(() => { void load(); }, []);

  const parsed = rows.map((r) => ({
    ...r,
    operator: r.operator || '未记录',
    detail: r.detail || r.result || '—',
    module: r.question.split(']')[0].replace('[', ''),
    action: r.question.split(']')[1]?.trim() ?? r.question,
  }));

  const filtered = parsed.filter((r) =>
    (!keyword || r.action.includes(keyword) || r.operator?.includes(keyword)) &&
    (!moduleFilter || r.module === moduleFilter));

  function exportCsv() {
    const head = '时间,操作人,模块,操作,详情\n';
    const cell = (value: string) => `"${(/^[=+@\-\t\r]/.test(value) ? "'" + value : value).replace(/"/g, '""')}"`;
    const body = filtered.map((r) => [fmtDateTime(r.createdAt), r.operator, r.module, r.action, r.detail].map(cell).join(',')).join('\n');
    const blob = new Blob(['﻿' + head + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `logs-${todayStamp()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <PageData state={pageLoad} onRetry={load}>
      <div className="page-header">
        <div>
          <h1>操作日志</h1>
          <div className="desc">最近的配置变更及执行结果；历史记录未采集的操作人显示为“未记录”。</div>
        </div>
        <AsyncButton className="btn btn-secondary" onClick={exportCsv}>⬇ 导出</AsyncButton>
      </div>

      <div className="flex gap-3" style={{ marginBottom: 12 }}>
        <input className="input" style={{ width: 200 }} placeholder="搜索操作人/关键词…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        <select className="select" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
          <option value="">全部模块</option>
          {MODULES.map((m) => <option key={m}>{m}</option>)}
        </select>
        <span className="small muted" style={{ alignSelf: 'center' }}>{filtered.length} 条</span>
      </div>

      <div className="card">
        <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
          <thead><tr><th>时间</th><th>操作人</th><th>模块</th><th>操作</th><th>详情</th><th>Trace ID</th></tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td className="muted small">{fmtDateTime(r.createdAt)}</td>
                <td className="small">{r.operator}</td>
                <td><span className="badge badge-info">{r.module || '—'}</span></td>
                <td className="small">{r.action}</td>
                <td className="muted small" title={r.detail} style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.detail}</td>
                <td className="muted small" style={{ fontFamily: 'monospace' }}>{r.traceId?.slice(0, 10) ?? '—'}</td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 32 }}>暂无操作记录（配置变更后产生）</td></tr>}
          </tbody>
        </table></div>
      </div>
    </PageData>
  );
}
