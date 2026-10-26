import { PageData, AsyncButton } from '../components/Interaction';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { fmtMDHM } from '../api/datetime';

interface N { id: string; type: string; title: string; content: string; isRead: boolean; link?: string; tenantId?: string; createdAt: string }

const TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  quota: { label: '额度预警', cls: 'badge-warning' },
  tenant_abnormal: { label: '租户异常', cls: 'badge-error' },
  verification: { label: '核销待处理', cls: 'badge-warning' },
  system: { label: '系统公告', cls: 'badge-neutral' },
  broadcast_failed: { label: '群发失败', cls: 'badge-error' },
  handoff: { label: '转人工', cls: 'badge-warning' },
};

/** 类型化处理入口文案（platform-notifications.html：去核销/去开通/处理） */
const ACTION_LABEL: Record<string, string> = {
  verification: '去核销 →',
  tenant_abnormal: '去开通 →',
  quota: '去处理 →',
};

export default function PlatformNotifications() {
  const [rows, setRows] = useState<N[]>([]);
  const [unread, setUnread] = useState(0);
  const [checked, setChecked] = useState<string[]>([]);

  const [pageLoad, setPageLoad] = useState({ loading: true, ready: false, error: '' });
  async function load() {
    setPageLoad(old => ({ ...old, loading: true, error: '' }));
    try {
    setRows(await api<N[]>('/api/v1/platform/notifications'));
    setUnread((await api<{ count: number }>('/api/v1/platform/notifications/unread-count')).count);

      setPageLoad({ loading: false, ready: true, error: '' });
    } catch (cause) { setPageLoad(old => ({ ...old, loading: false, error: (cause as Error).message })); }
  }
  useEffect(() => { load().catch(() => {}); }, []);

  async function markRead(id: string) {
    await api(`/api/v1/platform/notifications/${id}/read`, { method: 'PATCH' });
    load();
  }

  async function readAll() {
    await api('/api/v1/platform/notifications/read-all', { method: 'PATCH' });
    load();
  }

  const toggle = (id: string) => setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const toggleAll = () => setChecked(checked.length === rows.length && rows.length > 0 ? [] : rows.map((r) => r.id));

  /** 批量标记已读（逐条 PATCH 未读勾选项） */
  async function markSelectedRead() {
    const ids = checked.filter((id) => rows.find((r) => r.id === id && !r.isRead));
    await Promise.all(ids.map((id) => api(`/api/v1/platform/notifications/${id}/read`, { method: 'PATCH' }).catch(() => {})));
    setChecked([]);
    load();
  }

  return (
    <><PageData state={pageLoad} onRetry={load}>
      <div className="page-header">
        <div>
          <h1>通知中心（平台）</h1>
          <div className="desc">平台维度事件：额度预警 · 租户异常 · 核销待处理 · 系统公告</div>
        </div>
        {checked.length > 0 && <AsyncButton className="btn btn-secondary" onClick={markSelectedRead}>已选 {checked.length} 条标记已读</AsyncButton>}
        <AsyncButton className="btn btn-secondary" onClick={readAll}>全部已读</AsyncButton>
        <span className="badge badge-error">{unread} 未读</span>
      </div>

      <div className="card">
        <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
          <thead><tr><th style={{ width: 36 }}><input type="checkbox" checked={rows.length > 0 && checked.length === rows.length} onChange={toggleAll} /></th><th>类型</th><th>标题</th><th>内容</th><th>时间</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.id} style={!n.isRead ? { fontWeight: 500 } : {}}>
                <td><input type="checkbox" checked={checked.includes(n.id)} onChange={() => toggle(n.id)} /></td>
                <td><span className={`badge ${TYPE_LABEL[n.type]?.cls ?? 'badge-neutral'}`}>{TYPE_LABEL[n.type]?.label ?? n.type}</span></td>
                <td>{n.title}</td>
                <td className="muted small" style={{ maxWidth: 300 }}>{n.content}</td>
                <td className="muted small">{fmtMDHM(n.createdAt || '')}</td>
                <td>{n.isRead ? <span className="muted small">已读</span> : <span className="badge badge-error">未读</span>}</td>
                <td>
                  {!n.isRead && <AsyncButton className="link" onClick={() => markRead(n.id)}>标记已读</AsyncButton>}
                  {n.link && <a className="link" style={{ marginLeft: 10 }} href={n.link}>{ACTION_LABEL[n.type] ?? '处理 →'}</a>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 32 }}>暂无通知</td></tr>}
          </tbody>
        </table></div>
      </div>
    </PageData></>
  );
}
