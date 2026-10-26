import { useFeedback, PageData, Feedback, Modal, confirmAction, AsyncButton } from '../../components/Interaction';
import { useEffect, useState } from 'react';
import RobotConfig from './RobotConfig';
import { DEFAULT_COLLECTION } from './RobotCollection';
import { api, CURRENT_TENANT_ID } from '../../api/client';
import type { Robot } from '../../api/types';
import { fmtMDHM } from '../../api/datetime';

const TID = CURRENT_TENANT_ID;
const CHANNEL_ICON: Record<string, string> = { wecom: '💼', dingtalk: '🔷', feishu: '🪶', web: '🌐' };

export default function Robots() {
  const [detailId, setDetailId] = useState('');
  const [robots, setRobots] = useState<Robot[]>([]);
  const [channels, setChannels] = useState<Array<{ id: string; type: string; bindRobotId?: string | null; status: string }>>([]);
  const [kbs, setKbs] = useState<Array<{ id: string; datasetId: string; name: string }>>([]);
  const [msg, setMsg] = useFeedback();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('客服机器人');
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const [pageLoad, setPageLoad] = useState({ loading: true, ready: false, error: '' });
  async function load() {
    setPageLoad(old => ({ ...old, loading: true, error: '' }));
    try {
    setRobots(await api<Robot[]>(`/api/v1/tenant/robots?tenantId=${TID}`));
    setChannels(await api<Array<{ id: string; type: string; bindRobotId?: string | null; status: string }>>(`/api/v1/tenant/channels?tenantId=${TID}`));
    setKbs(await api<Array<{ id: string; datasetId: string; name: string }>>(`/api/v1/tenant/knowledge-base?tenantId=${TID}`).catch(() => []));

      setPageLoad({ loading: false, ready: true, error: '' });
    } catch (cause) { setPageLoad(old => ({ ...old, loading: false, error: (cause as Error).message })); }
  }
  useEffect(() => { load().catch(() => {}); }, []);

  const robotChannels = (rid: string) =>
    channels.filter((c) => c.bindRobotId === rid && c.status === 'connected').map((c) => c.type);
  /** 知识候选池名称（robots.html：逐库展示，悬浮看全部） */
  const kbNames = (ids: string[]) => ids
    .map((id) => kbs.find((k) => k.id === id || k.datasetId === id)?.name ?? id.slice(0, 8));
  const STATUS_LABEL: Record<string, string> = { PUBLISHED: '已发布', DRAFT: '草稿', DISABLED: '已禁用', DELETED: '已删除' };

  const filtered = robots.filter((r) =>
    (!keyword || r.name.includes(keyword)) &&
    (!statusFilter || r.status === statusFilter) &&
    (!typeFilter || r.type === typeFilter),
  );

  async function create() {
    try {
      await api('/api/v1/tenant/robots', {
        method: 'POST',
        body: JSON.stringify({ tenantId: TID, name, type, kbPool: [], toolIdentifiers: [], ...(type === '信息收集机器人' ? { ragConfig: { mode: 'collector', collection: DEFAULT_COLLECTION } } : {}) }),
      });
      setMsg('✅ 机器人已创建（草稿）'); setShowCreate(false); setName(''); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function publish(id: string) {
    try { await api(`/api/v1/tenant/robots/${id}/publish`, { method: 'POST' }); setMsg('✅ 已发布'); load(); }
    catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function disable(id: string, rname: string) {
    if (!(await confirmAction(`确认禁用机器人「${rname}」？禁用后群消息不再处理`, { confirmText: '确认禁用' }))) return;
    try { await api(`/api/v1/tenant/robots/${id}/disable`, { method: 'POST' }); setMsg(`✅ 已禁用「${rname}」`); load(); }
    catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function remove(id: string, rname: string) {
    if (!(await confirmAction(`确认删除机器人「${rname}」？关联群将自动解绑，不可恢复`, { confirmText: '确认删除' }))) return;
    try { await api(`/api/v1/tenant/robots/${id}?tenantId=${TID}`, { method: 'DELETE' }); setMsg(`✅ 已删除「${rname}」（关联群已解绑）`); load(); }
    catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  return (
    <><PageData state={pageLoad} onRetry={load}>
      <div className="page-header">
        <div>
          <h1>机器人管理</h1>
          <div className="desc">创建/发布机器人 · 绑定 Dify App · 知识候选池</div>
        </div>
        <AsyncButton className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>+ 新建机器人</AsyncButton>
      </div>

      {showCreate && (
        <Modal title="新建机器人" onClose={() => setShowCreate(false)}><div className="card">

          <div className="flex gap-3">
            <input className="input" placeholder="机器人名称" value={name} onChange={(e) => setName(e.target.value)} />
            <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
              <option>客服机器人</option><option>内部知识机器人</option><option>运营机器人</option><option>信息收集机器人</option>
            </select>
            <AsyncButton className="btn btn-primary btn-sm" disabled={!name.trim()} onClick={create}>创建</AsyncButton>
          </div>
          <div className="small muted mt-3">创建后进入配置页，设置问答规则或信息收集规则，再发布并绑定群。</div>
          {msg && <Feedback message={msg} />}
        </div></Modal>
      )}

      {msg && <Feedback message={msg} />}

      {/* 筛选栏（对齐原型） */}
      <div className="flex gap-3" style={{ marginBottom: 12 }}>
        <input className="input" style={{ width: 200 }} placeholder="搜索机器人名称…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">全部状态</option><option value="PUBLISHED">已发布</option><option value="DRAFT">草稿</option><option value="DISABLED">已禁用</option>
        </select>
        <select className="select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">全部类型</option><option>客服机器人</option><option>内部知识机器人</option><option>运营机器人</option><option>信息收集机器人</option>
        </select>
        <span className="small muted" style={{ alignSelf: 'center' }}>{filtered.length} / {robots.length} 个</span>
      </div>

      <div className="card">
        <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
          <thead><tr><th>名称</th><th>类型</th><th>Dify App</th><th>渠道</th><th>知识候选池</th><th>创建时间</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} onClick={() => setDetailId(r.id)} style={{ cursor: 'pointer' }}>
                <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{r.name}</td>
                <td>{r.type}</td>
                <td className="muted small">{r.difyAppId?.slice(0, 12)}…</td>
                <td>{robotChannels(r.id).map((c) => <span key={c} title={c}>{CHANNEL_ICON[c] ?? '🔌'}</span>)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {kbNames(r.kbPool).slice(0, 2).map((n) => <span key={n} className="perm-tag perm-internal" style={{ marginRight: 4 }}>{n}</span>)}
                  {r.kbPool.length > 2 && <span className="small muted" title={kbNames(r.kbPool).join('、')}>+{r.kbPool.length - 2}</span>}
                  {r.kbPool.length === 0 && <span className="small muted">未配置</span>}
                </td>
                <td className="muted small">{fmtMDHM(r.createdAt).slice(0, 16)}</td>
                <td><span className={`badge ${r.status === 'PUBLISHED' ? 'badge-success' : r.status === 'DISABLED' ? 'badge-warning' : 'badge-neutral'}`}>{STATUS_LABEL[r.status] ?? r.status}</span></td>
                <td onClick={(e) => e.stopPropagation()}>
                  <AsyncButton className="link" onClick={() => setDetailId(r.id)}>配置</AsyncButton>
                  {r.status === 'DRAFT' && <AsyncButton className="link" style={{ marginLeft: 10 }} onClick={() => publish(r.id)}>发布</AsyncButton>}
                  {r.status !== 'DISABLED' && <AsyncButton className="link" style={{ marginLeft: 10, color: 'var(--error)' }} onClick={() => disable(r.id, r.name)}>禁用</AsyncButton>}
                  <AsyncButton className="link" style={{ marginLeft: 10, color: 'var(--error)' }} onClick={() => remove(r.id, r.name)}>删除</AsyncButton>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 32 }}>暂无机器人</td></tr>}
          </tbody>
        </table></div>
      </div>
      {detailId && <Modal title="机器人配置" drawer onClose={() => setDetailId('')}><RobotConfig robotId={detailId} onClose={() => { setDetailId(''); void load(); } } /></Modal>}
    </PageData></>
  );
}
