import { useFeedback, Feedback, AsyncButton, notify } from './Interaction';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
type Policy = { primaryModelId: string; fallbackModelId: string; rerankModelId: string };
type Model = { id?: string; name: string; purpose: string; isActive: boolean; tenantIds: string[] };
export default function TenantModelPolicy({ tenants, models }: { tenants: Array<{ id: string; name: string }>; models: Model[] }) {
  const [tenantId, setTenantId] = useState('');
  const [policy, setPolicy] = useState<Policy>({ primaryModelId: '', fallbackModelId: '', rerankModelId: '' });
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [ready, setReady] = useState(false), [message, setMessage] = useFeedback();
  useEffect(() => {
    setReady(false); setMessage('');
    if (!tenantId) return;
    let active = true;
    setLoading(true);
    api<Policy>(`/api/v1/admin/models/tenants/${tenantId}`).then(p => { if (active) { setPolicy(p); setReady(true); } }).catch(e => { if (active) setMessage(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantId]);
  async function save() {
    setSaving(true); setMessage('');
    try { await api(`/api/v1/admin/models/tenants/${tenantId}`, { method: 'PATCH', body: JSON.stringify(policy) }); notify('租户模型已保存，对该租户全部机器人生效'); }
    catch (e) { setMessage((e as Error).message); } finally { setSaving(false); }
  }
  return <section className="card rag-panel" style={{ marginBottom: 20 }}>
    <h2>租户模型配置</h2><p>按租户统一指定模型，适用于已有和新建机器人。租户端只能查看，不能修改。</p>
    <label>租户 <select className="select" value={tenantId} disabled={saving} onChange={e => setTenantId(e.target.value)}><option value="">选择租户</option>{tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    {loading && <p role="status">正在读取租户配置…</p>}
    {tenantId && ready && <><div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '16px 0' }}>
      {(['primaryModelId', 'fallbackModelId', 'rerankModelId'] as const).map((key, i) => {
        const available = models.filter(m => m.isActive && m.tenantIds.includes(tenantId) && m.purpose === (key === 'rerankModelId' ? 'rerank' : 'chat') && (key !== 'fallbackModelId' || m.id !== policy.primaryModelId));
        return <label key={key}>{['主模型', '备用模型', '重排模型'][i]} <select className="select" disabled={saving} value={policy[key]} onChange={e => setPolicy({ ...policy, [key]: e.target.value })}><option value="">{i === 0 ? '请选择' : '不使用'}</option>{policy[key] && !available.some(m => m.id === policy[key]) && <option value={policy[key]} disabled>当前模型已停用或未授权，请重新选择</option>}{available.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>;
      })}
    </div><p className="small">仅可选已启用并授权给该租户的模型。主模型首次失败后重试 3 次，再使用备用模型。</p><AsyncButton className="btn btn-primary" disabled={saving || !policy.primaryModelId} onClick={save}>{saving ? '保存中…' : '保存租户模型'}</AsyncButton></>}
    {message && <Feedback message={message} />}
  </section>;
}
