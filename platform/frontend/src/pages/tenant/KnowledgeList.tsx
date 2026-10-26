import { useFeedback, PageData, Feedback, Modal, confirmAction, AsyncButton, ModalFrame } from '../../components/Interaction';
import { useEffect, useState } from 'react';
import KnowledgeDetail from './KnowledgeDetail';
import { api, CURRENT_TENANT_ID } from '../../api/client';
import { fmtDate } from '../../api/datetime';

const TID = CURRENT_TENANT_ID;
const KB_NAME: Record<string, string> = { '5d4ddffa-1e46-479e-bd36-4a5e9f976ba6': '玩家攻略库', 'abc52e4b-ec22-4578-980e-0aa922b2c527': '运营规则库' };

interface Kb { id: string; datasetId: string; name: string; visibility: string; deptIds: string[]; deptNames?: string[]; fileCount?: number; syncStatus?: string; updatedAt?: string; createdAt?: string; createdBy?: string }
interface Dept { id: string; name: string }

export default function KnowledgeList() {
  const [detailId, setDetailId] = useState('');
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [visibility, setVisibility] = useState<'all' | 'restricted'>('all');
  const [deptIds, setDeptIds] = useState<string[]>([]);
  const [editKb, setEditKb] = useState<Kb | null>(null);
  const [msg, setMsg] = useFeedback();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [pageLoad, setPageLoad] = useState({ loading: true, ready: false, error: '' });
  async function load() {
    setPageLoad(old => ({ ...old, loading: true, error: '' }));
    try {
    const d = await api<Kb[]>(`/api/v1/tenant/knowledge-base?tenantId=${TID}`);
    setKbs(d.map((x) => ({ ...x, name: KB_NAME[x.datasetId] ?? x.name })));
    setDepts(await api<Dept[]>(`/api/v1/tenant/roles/depts?tenantId=${TID}`));

      setPageLoad({ loading: false, ready: true, error: '' });
    } catch (cause) { setPageLoad(old => ({ ...old, loading: false, error: (cause as Error).message })); }
  }
  useEffect(() => { load().catch(() => {}); }, []);

  const toggle = (arr: string[], v: string) => arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  async function create() {
    if (!newName.trim()) return;
    try {
      await api<{ datasetId: string }>('/api/v1/tenant/knowledge', {
        method: 'POST',
        body: JSON.stringify({ tenantId: TID, name: newName, visibility, deptIds: visibility === 'restricted' ? deptIds : [] }),
      });
      setMsg(`✅ 「${newName}」已创建（${visibility === 'restricted' ? `指定 ${deptIds.length} 部门可见` : '全部部门可见'}）`);
      setShowCreate(false); setNewName(''); setVisibility('all'); setDeptIds([]);
      load();

    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function saveVisibility() {
    if (!editKb) return;
    try {
      await api(`/api/v1/tenant/knowledge-base/${editKb.id}/visibility`, {
        method: 'PUT',
        body: JSON.stringify({ visibility, deptIds: visibility === 'restricted' ? deptIds : [] }),
      });
      setMsg(`✅ 可见部门已更新（${visibility === 'restricted' ? `${deptIds.length} 部门` : '全部部门'}）`);
      setEditKb(null); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  function openEdit(kb: Kb) {
    setEditKb(kb);
    setVisibility((kb.visibility ?? 'all') as 'all' | 'restricted');
    setDeptIds(kb.deptIds ?? []);
  }

  async function removeKb(kb: Kb) {
    if (!(await confirmAction(`确认删除知识库「${kb.name}」？（空库才可删除，Dify Dataset 保留可重绑）`, { confirmText: '确认删除' }))) return;
    try {
      await api(`/api/v1/tenant/knowledge-base/${kb.id}`, { method: 'DELETE' });
      setMsg(`✅ 已删除「${kb.name}」`); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  const SYNC_META: Record<string, { label: string; cls: string }> = {
    已同步: { label: '✅ 已同步', cls: 'badge-success' },
    同步中: { label: '⏳ 同步中', cls: 'badge-warning' },
    待同步: { label: '待同步', cls: 'badge-warning' },
    同步失败: { label: '同步失败', cls: 'badge-danger' },
    空: { label: '空', cls: 'badge-neutral' },
  };
  const filteredKbs = kbs.filter((kb) => (!keyword || kb.name.includes(keyword)) && (!statusFilter || (kb.syncStatus ?? '空') === statusFilter));

  return (
    <><PageData state={pageLoad} onRetry={load}>
      <div className="page-header">
        <div>
          <h1>知识库</h1>
          <div className="desc">管理知识范围与部门可见权限 · 点击进入详情（上传/预览/更新/下载）</div>
        </div>
        <input className="input" style={{ width: 180 }} placeholder="搜索知识库…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">全部状态</option>
          <option value="已同步">已同步</option>
          <option value="同步中">同步中</option>
          <option value="待同步">待同步</option>
          <option value="同步失败">同步失败</option>
          <option value="空">空</option>
        </select>
        <AsyncButton className="btn btn-primary" onClick={() => { setEditKb(null); setNewName(''); setVisibility('all'); setDeptIds([]); setShowCreate(true); }}>+ 新建知识库</AsyncButton>
      </div>

      {msg && <Feedback message={msg} />}

      <div className="card">
        <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
          <thead><tr><th>知识库名称</th><th>Dify Dataset ID</th><th>文件数</th><th>同步状态</th><th>可见部门</th><th>更新时间</th><th>添加人</th><th>操作</th></tr></thead>
          <tbody>
            {filteredKbs.map((kb) => {
              const sync = SYNC_META[kb.syncStatus ?? '空'] ?? SYNC_META['空'];
              return (
              <tr key={kb.id}>
                <td onClick={() => setDetailId(kb.datasetId)} style={{ fontWeight: 500, color: 'var(--text-primary)', cursor: 'pointer' }}>📚 {kb.name}</td>
                <td className="mono muted small" style={{ fontFamily: 'ui-monospace, monospace' }}>{kb.datasetId}</td>
                <td className="muted small">{kb.fileCount ?? 0}</td>
                <td><span className={`badge ${sync.cls}`}>{sync.label}</span></td>
                <td>
                  {kb.visibility === 'restricted'
                    ? <span className="badge badge-info">🔒 {(kb.deptNames ?? []).join('、') || `${(kb.deptIds ?? []).length} 部门`}</span>
                    : <span className="badge badge-success">🌐 全部部门</span>}
                </td>
                <td className="muted small">{fmtDate(kb.updatedAt ?? kb.createdAt ?? '') ?? '—'}</td>
                <td className="muted small">{kb.createdBy ?? '—'}</td>
                <td className="cell-actions" style={{ whiteSpace: 'nowrap' }}>
                  <AsyncButton className="link" onClick={() => setDetailId(kb.datasetId)}>详情</AsyncButton>
                  <AsyncButton className="link" style={{ marginLeft: 8 }} onClick={() => openEdit(kb)}>编辑可见部门</AsyncButton>
                  <AsyncButton className="link danger" style={{ marginLeft: 8 }} onClick={() => removeKb(kb)}>删除</AsyncButton>
                </td>
              </tr>
              );
            })}
            {filteredKbs.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 32 }}>{kbs.length ? '无匹配知识库' : '暂无知识库，点击「新建知识库」'}</td></tr>}
          </tbody>
        </table></div>
        <div className="ai-warning info mt-4">
          <span className="ic">📌</span>
          <div>知识库对应 Dify Dataset。当前上传单文件上限为 15 MB，超限将拒绝整个文件，不会截断正文。知识库数量受租户套餐配额限制。</div>
        </div>
      </div>

      {/* 新建/编辑弹窗（可见部门配置） */}
      {(showCreate || editKb) && (
        <ModalFrame title={editKb ? '编辑可见部门' : '新建知识库'} onClose={() => { (setShowCreate(false), setEditKb(null)); }}>
          <div className="card" style={{ width: 460, maxWidth: '94vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="card-title">{editKb ? `编辑可见部门 — ${editKb.name}` : '新建知识库'}</div>
              <AsyncButton closeDialog style={{ cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)' }} onClick={() => { setShowCreate(false); setEditKb(null); }}>✕</AsyncButton>
            </div>

            {!editKb && (
              <>
                <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>知识库名称</div>
                <input className="input" style={{ width: '100%', marginBottom: 14 }} placeholder="知识库名称" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </>
            )}

            <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>可见部门权限</div>
            <label className="flex gap-3" style={{ gap: 8, fontSize: 14, padding: '6px 0', cursor: 'pointer' }}>
              <input type="radio" checked={visibility === 'all'} onChange={() => setVisibility('all')} style={{ accentColor: 'var(--primary)' }} />
              🌐 所有部门都可以查看
            </label>
            <label className="flex gap-3" style={{ gap: 8, fontSize: 14, padding: '6px 0', marginBottom: 8, cursor: 'pointer' }}>
              <input type="radio" checked={visibility === 'restricted'} onChange={() => setVisibility('restricted')} style={{ accentColor: 'var(--primary)' }} />
              🔒 仅指定部门可查看
            </label>

            {visibility === 'restricted' && (
              <div style={{ border: '1px solid var(--border-light)', borderRadius: 8, padding: 10, marginBottom: 14, maxHeight: 160, overflowY: 'auto' }}>
                {depts.map((d) => (
                  <label key={d.id} className="flex gap-3" style={{ gap: 8, fontSize: 13, padding: '6px 0', cursor: 'pointer' }}>
                    <input type="checkbox" checked={deptIds.includes(d.id)} onChange={() => setDeptIds(toggle(deptIds, d.id))} style={{ accentColor: 'var(--primary)' }} />
                    {d.name}
                  </label>
                ))}
                {depts.length === 0 && <div className="small muted">暂无部门（角色权限页可新建）</div>}
              </div>
            )}

            <div className="small muted" style={{ marginBottom: 16 }}>
              {editKb ? '保存后部门可见范围即时生效（角色知识白名单 ∩ 部门可见范围）' : '创建后为「空」状态；上传第一个文件时自动在 Dify 创建 Dataset'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <AsyncButton closeDialog className="btn btn-secondary" onClick={() => { setShowCreate(false); setEditKb(null); }}>取消</AsyncButton>
              <AsyncButton className="btn btn-primary" onClick={editKb ? saveVisibility : create}>{editKb ? '保存' : '创建'}</AsyncButton>
            </div>
          </div>
        </ModalFrame>
      )}
      {detailId && <Modal title="知识库详情" drawer onClose={() => setDetailId('')}><KnowledgeDetail datasetId={detailId} onClose={() => { setDetailId(''); void load(); } } /></Modal>}
    </PageData></>
  );
}
