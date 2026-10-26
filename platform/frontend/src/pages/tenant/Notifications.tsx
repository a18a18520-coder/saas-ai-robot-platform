import { PageData, AsyncButton } from '../../components/Interaction';
import { useEffect, useState } from 'react';
import { api, CURRENT_TENANT_ID } from '../../api/client';
import { fmtMDHM } from '../../api/datetime';

const TID = CURRENT_TENANT_ID;

interface Notification { id: string; type: string; title: string; content: string; isRead: boolean; link?: string; createdAt: string }

const TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  broadcast_failed: { label: '群发失败', cls: 'badge-error' },
  quota: { label: '额度预警', cls: 'badge-warning' },
  handoff: { label: '转人工', cls: 'badge-warning' },
  payment: { label: '支付', cls: 'badge-info' },
  activation: { label: '激活', cls: 'badge-info' },
  system: { label: '系统公告', cls: 'badge-neutral' },
};

export default function Notifications() {
  const [rows, setRows] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [showRead, setShowRead] = useState(false);

  const [pageLoad, setPageLoad] = useState({ loading: true, ready: false, error: '' });
  async function load() {
    setPageLoad(old => ({ ...old, loading: true, error: '' }));
    try {
    setRows(await api<Notification[]>(`/api/v1/tenant/notifications?tenantId=${TID}`));
    setUnread((await api<{ count: number }>(`/api/v1/tenant/notifications/unread-count?tenantId=${TID}`)).count);
    setSelected([]);

      setPageLoad({ loading: false, ready: true, error: '' });
    } catch (cause) { setPageLoad(old => ({ ...old, loading: false, error: (cause as Error).message })); }
  }
  useEffect(() => { load().catch(() => {}); }, []);

  async function markRead(id: string) {
    await api(`/api/v1/tenant/notifications/${id}/read`, { method: 'PATCH' });
    window.dispatchEvent(new Event('tenant-notifications-changed'));
    await load();
  }
  async function markAll() {
    await api('/api/v1/tenant/notifications/read-all', { method: 'PATCH', body: JSON.stringify({ tenantId: TID }) });
    window.dispatchEvent(new Event('tenant-notifications-changed'));
    await load();
  }
  /** 批量标记已读（勾选项） */
  async function markSelected() {
    try {
      for (const id of selected) await api(`/api/v1/tenant/notifications/${id}/read`, { method: 'PATCH' });
    } finally {
      window.dispatchEvent(new Event('tenant-notifications-changed'));
      await load();
    }
  }
  const toggleSel = (id: string) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <><PageData state={pageLoad} onRetry={load}>
      <div className="page-header">
        <div>
          <h1>通知中心</h1>
          <div className="desc">群发失败人工介入 / 额度预警 / 转人工 / 系统公告</div>
        </div>
        <div className="flex gap-3">
          <label><input type="checkbox" checked={showRead} onChange={e => { setShowRead(e.target.checked); setSelected([]); }} /> 显示已读</label>
          <span className="badge badge-error">{unread} 未读</span>
          {selected.length > 0 && <AsyncButton className="btn btn-primary" onClick={markSelected}>已选 {selected.length} 条标记已读</AsyncButton>}
          <AsyncButton className="btn btn-secondary" onClick={markAll}>全部已读</AsyncButton>
        </div>
      </div>

      <div className="card">
        <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
          <thead><tr><th style={{ width: 34 }}></th><th>类型</th><th>标题</th><th>内容</th><th>时间</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {rows.filter(n => showRead || !n.isRead).map((n) => {
              const t = TYPE_LABEL[n.type] ?? TYPE_LABEL.system;
              return (
                <tr key={n.id} style={{ ...(selected.includes(n.id) ? { background: 'var(--primary-light)' } : {}), ...(!n.isRead ? { fontWeight: 500 } : {}) }}>
                  <td>
                    <input type="checkbox" checked={selected.includes(n.id)} onChange={() => toggleSel(n.id)} style={{ accentColor: 'var(--primary)' }} />
                  </td>
                  <td><span className={`badge ${t.cls}`}>{t.label}</span></td>
                  <td style={{ color: 'var(--text-primary)' }}>{n.title}</td>
                  <td className="muted">{n.content}</td>
                  <td className="muted small">{fmtMDHM(n.createdAt || '')}</td>
                  <td>{n.isRead ? <span className="badge badge-neutral">已读</span> : <span className="badge badge-error">未读</span>}</td>
                  <td>
                    {!n.isRead && <AsyncButton className="link" onClick={() => markRead(n.id)}>标记已读</AsyncButton>}
                    {n.link && <AsyncButton className="link" style={{ marginLeft: 8 }} onClick={() => (window.location.href = n.link!)}>去处理 →</AsyncButton>}
                  </td>
                </tr>
              );
            })}
            {!rows.some(n => showRead || !n.isRead) && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 32 }}>{showRead ? '暂无通知' : '暂无未读通知，可勾选“显示已读”查看历史。'}</td></tr>}
          </tbody>
        </table></div>
      </div>
    </PageData></>
  );
}
