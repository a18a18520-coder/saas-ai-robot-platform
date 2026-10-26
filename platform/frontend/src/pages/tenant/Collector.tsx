import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { AsyncButton, Feedback, confirmAction } from '../../components/Interaction';

type Device = { id: string; name: string; accountId: string; status: string; createdAt: string };
type Message = { id: string; accountId: string; deviceId: string; senderNickname: string; isSelf: boolean; identitySource: string; content: string; capturedAt: string; sentAtRaw: string | null; processingStatus: string; collectionId: string | null; group: { name: string; id: string; robotId?: string } | null };
const labels: Record<string, string> = { received: '已接收，等待处理', awaiting_robot: '待绑定收集机器人', processing: '提取中', collected: '已收集', needs_review: '提取结果待核对', failed: '提取失败', blocked: '已拦截', ignored: '规则忽略' };
const root = '/api/v1/tenant/collector';

export default function Collector() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [data, setData] = useState<{ items: Message[]; total: number } | null>(null);
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const refresh = useCallback(() => setRevision(r => r + 1), []);
  useEffect(() => {
    let live = true; setLoading(true); setError(''); setData(null);
    Promise.all([api<Device[]>(`${root}/devices`), api<{ items: Message[]; total: number }>(`${root}/messages?page=${page}`)])
      .then(([ds, rows]) => { if (live) { setDevices(ds); setData(rows); } })
      .catch(e => { if (live) setError((e as Error).message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [page, revision]);
  async function revoke(device: Device) {
    if (!await confirmAction(`撤销「${device.name}」后，该设备不能再使用此账号同步。已接收的历史消息保留。此版本不支持恢复同一设备授权。`, { title: '撤销采集设备', confirmText: '确认撤销', danger: true })) return;
    try { await api(`${root}/devices/${device.id}/revoke`, { method: 'POST' }); refresh(); } catch (e) { setError((e as Error).message); }
  }
  async function process(row: Message) {
    try { await api(`${root}/messages/${row.id}/process`, { method: 'POST' }); refresh(); } catch (e) { setError((e as Error).message); }
  }
  return <div>
    <div className="page-header"><div><h1>微信采集</h1><p className="small">插件登录租户账号后，按明确关联的群同步。昵称是截图识别或人工核对信息，不等同于已验证的微信用户身份。</p></div><AsyncButton className="btn btn-secondary" disabled={loading} onClick={refresh}>刷新数据</AsyncButton></div>
    <Feedback message={error} />
    <details className="card" style={{ marginBottom: 20 }}><summary style={{ cursor: 'pointer' }}>采集设备 · {devices.length}</summary>
      <p className="small">管理员可撤销本租户设备，其他账号仅管理自己登录的设备。插件退出登录即停止新同步；撤销不删除历史消息。</p>
      {!loading && !devices.length && <p>尚无设备。请在采集助手的“租户同步”中登录。</p>}
      {devices.map(d => <div key={d.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 200, overflowWrap: 'anywhere' }}><strong>{d.name}</strong> · {d.status === 'ACTIVE' ? '已授权' : '已撤销'}<p className="small">设备 {d.id} · 操作账号 ID {d.accountId}</p></div>
        <AsyncButton className="btn btn-secondary" disabled={d.status !== 'ACTIVE'} onClick={() => revoke(d)}>撤销设备</AsyncButton>
      </div>)}
    </details>
    <h2>已同步原文</h2><p className="small">“本人”指采集时登录微信的账号，与插件的租户操作账号无关。新群先到 <Link to="/t/groups">群管理</Link> 绑定已发布的信息收集机器人，再点击处理原文。平台接收与字段提取分别显示。</p>
    {loading && <p role="status">正在加载…</p>}
    {!loading && !error && !data?.items.length && <p className="ui-empty">暂无同步消息。请在插件选择会话、关联租户群并开启同步；无法确认发送人的消息仍留在插件待核对。</p>}
    {data?.items.map(m => <article key={m.id} style={{ borderBottom: '1px solid var(--border)', padding: '20px 0', overflowWrap: 'anywhere' }}>
      <h3>{m.group?.name || '群已删除'} · {m.senderNickname}{m.isSelf ? '（本人）' : ''}</h3>
      <p style={{ whiteSpace: 'pre-wrap' }}>{m.content}</p>
      <p className="small">已接收 · {labels[m.processingStatus] || m.processingStatus} · {m.identitySource === 'manual_review' ? '人工核对' : '图像布局识别'}（身份未验证）</p>
      <p className="small">采集于 {new Date(m.capturedAt).toLocaleString()} · 原始时间标记：{m.sentAtRaw || '无，未推算'}</p>
      <details><summary>来源追溯</summary><p className="small">操作账号 ID：{m.accountId}<br />设备：{m.deviceId}<br />原文记录：{m.id}<br />提取记录：{m.collectionId || '尚未创建'}</p></details>
      {!m.collectionId && <AsyncButton className="btn btn-secondary" onClick={() => process(m)}>按当前已发布规则处理</AsyncButton>}
      {m.group?.robotId && <Link className="btn btn-secondary" to={`/t/robots/${m.group.robotId}`}>查看机器人与收集结果</Link>}
    </article>)}
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 20 }}><button className="btn btn-secondary" disabled={loading || page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button><span>第 {page} 页 · 共 {data?.total ?? '—'} 条</span><button className="btn btn-secondary" disabled={loading || !data || page * 50 >= data.total} onClick={() => setPage(p => p + 1)}>下一页</button></div>
  </div>;
}
