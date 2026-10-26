import { useFeedback, PageData, Feedback, AsyncButton, ModalFrame } from '../components/Interaction';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { fmtDateTime } from '../api/datetime';

interface Order {
  id: string; tenantName?: string; planName: string; amount: number; payType: string;
  status: string; remark?: string; createdAt: string; paidAt?: string;
}

const PAY_TYPE: Record<string, string> = { WECHAT: '微信扫码', ALIPAY: '支付宝扫码', BANK_TRANSFER: '对公转账' };
const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: '待支付', cls: 'badge-warning' },
  PENDING_VERIFICATION: { label: '待核销', cls: 'badge-error' },
  PAID: { label: '已支付', cls: 'badge-success' },
  CANCELLED: { label: '已取消', cls: 'badge-neutral' },
};
const fmtPrice = (n: number) => '¥' + (n / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 });

/** 平台支付核销（对公转账待核销 → 确认到账 → 套餐生效） */
export default function PlatformPayments() {
  const [rows, setRows] = useState<Order[]>([]);
  const [status, setStatus] = useState('PENDING_VERIFICATION');
  const [msg, setMsg] = useFeedback();
  const [verifyTarget, setVerifyTarget] = useState<Order | null>(null); // 核销确认 Modal
  const [note, setNote] = useState('已核对到账');
  const [verifying, setVerifying] = useState(false);

  const [pageLoad, setPageLoad] = useState({ loading: true, ready: false, error: '' });
  async function load() {
    setPageLoad(old => ({ ...old, loading: true, error: '' }));
    try {
    // api() 已解包 body.data（数组），直接使用，勿再取 .data（双重解包 → 永远空列表）
    const d = await api<Order[]>(`/api/v1/admin/payments${status ? `?status=${status}` : ''}`);
    setRows(Array.isArray(d) ? d : []);

      setPageLoad({ loading: false, ready: true, error: '' });
    } catch (cause) { setPageLoad(old => ({ ...old, loading: false, error: (cause as Error).message })); }
  }
  useEffect(() => { load().catch(() => {}); }, [status]);

  function openVerify(o: Order) { setVerifyTarget(o); setNote('已核对到账'); }

  async function confirmVerify() {
    if (!verifyTarget) return;
    setVerifying(true);
    try {
      await api<Order>(`/api/v1/admin/payments/${verifyTarget.id}/verify`, { method: 'POST', body: JSON.stringify({ note: note.trim() || undefined }) });
      setMsg(`✅ 已核销，「${verifyTarget.planName}」套餐已生效`);
      setVerifyTarget(null); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); } finally { setVerifying(false); }
  }

  return (
    <><PageData state={pageLoad} onRetry={load}>
      <div className="page-header">
        <div>
          <h1>支付核销</h1>
          <div className="desc">对公转账到账核对 → 核销后租户套餐生效（扫码支付自动生效）</div>
        </div>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="PENDING_VERIFICATION">待核销</option>
          <option value="PAID">已支付</option>
          <option value="PENDING">待支付</option>
          <option value="">全部</option>
        </select>
      </div>

      {msg && <Feedback message={msg} />}

      <div className="card">
        <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
          <thead><tr><th>时间</th><th>租户</th><th>套餐</th><th>金额</th><th>支付方式</th><th>状态</th><th>备注</th><th>操作</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={r.status === 'PENDING_VERIFICATION' ? { background: 'var(--error-bg)' } : {}}>
                <td className="muted small">{fmtDateTime(r.createdAt || '')}</td>
                <td className="cell-strong">{r.tenantName ?? '—'}</td>
                <td>{r.planName}</td>
                <td style={{ fontWeight: 600 }}>{fmtPrice(r.amount)}</td>
                <td className="small">{PAY_TYPE[r.payType] ?? r.payType}</td>
                <td><span className={`badge ${STATUS[r.status]?.cls ?? 'badge-neutral'}`}>{STATUS[r.status]?.label ?? r.status}</span></td>
                <td className="muted small" style={{ maxWidth: 160 }}>{r.remark ?? '—'}</td>
                <td>
                  {r.status === 'PENDING_VERIFICATION' && <AsyncButton className="btn btn-primary btn-sm" onClick={() => openVerify(r)}>核销</AsyncButton>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 32 }}>暂无记录</td></tr>}
          </tbody>
        </table></div>
      </div>

      {/* 核销确认 Modal（自定义弹窗，备注输入） */}
      {verifyTarget && (
        <ModalFrame title="核销对公转账" onClose={() => { !verifying && setVerifyTarget(null); }}>
          <div className="modal">
            <div className="m-head"><h3>核销对公转账</h3><AsyncButton closeDialog className="x" onClick={() => !verifying && setVerifyTarget(null)}>✕</AsyncButton></div>
            <div className="m-body">
              <div style={{ fontSize: 14, marginBottom: 12 }}>
                「<b>{verifyTarget.tenantName}</b>」转账 <b style={{ color: 'var(--success-text)' }}>{fmtPrice(verifyTarget.amount)}</b> 购买「{verifyTarget.planName}」，确认已核对到账？
              </div>
              <div className="form-item"><label>核销备注（写入订单记录）</label>
                <input className="input" style={{ width: '100%' }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="已核对到账" autoFocus />
              </div>
            </div>
            <div className="m-foot">
              <AsyncButton closeDialog className="btn btn-secondary" onClick={() => setVerifyTarget(null)} disabled={verifying}>取消</AsyncButton>
              <AsyncButton className="btn btn-primary" disabled={verifying} onClick={confirmVerify}>{verifying ? '核销中…' : '确认核销'}</AsyncButton>
            </div>
          </div>
        </ModalFrame>
      )}
    </PageData></>
  );
}
