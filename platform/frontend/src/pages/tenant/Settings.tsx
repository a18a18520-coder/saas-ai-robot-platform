import { useFeedback, Feedback, usePageTab, TabBar, TabPanel, confirmAction, AsyncButton, ModalFrame } from '../../components/Interaction';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { api, CURRENT_TENANT_ID } from '../../api/client';
import { fmtDateTime } from '../../api/datetime';

const TID = CURRENT_TENANT_ID;

interface Plan { id: string; name: string; price: number; validityDays: number; robotLimit: number; userLimit: number; kbLimit: number; aiQuota: number; storageLimitMb: number; channelLimit: number; adminWindowLimit: number; isFeatured?: boolean }
interface PayOrder { id: string; planName: string; amount: number; payType: string; status: string; qrContent?: string; bankInfo?: Record<string, string>; remark?: string; createdAt: string; paidAt?: string }
interface TenantRole { id: string; name: string; status: 'ACTIVE' | 'DISABLED'; isBuiltin: boolean; windowPermissions: string[] }
interface TenantAccountView { id: string; name: string; account: string; role: 'TENANT_ADMIN' | 'TENANT_OPS'; roleId?: string; roleName: string; roleAvailable: boolean; windows: string[]; status: 'ACTIVE' | 'DISABLED'; lastLoginAt?: string }
type PasswordComplexity = 'letters_numbers' | 'upper_lower_numbers' | 'upper_lower_numbers_symbols';
interface TenantSecurityPolicy {
  passwordMinLength: number; passwordComplexity: PasswordComplexity; passwordExpiryDays: number | null;
  lockMaxAttempts: number; lockMinutes: number; sessionTimeoutMinutes: number | null;
  ipWhitelistEnabled: boolean; ipWhitelist: string[];
}
const DEFAULT_SECURITY: TenantSecurityPolicy = {
  passwordMinLength: 10, passwordComplexity: 'letters_numbers', passwordExpiryDays: 90,
  lockMaxAttempts: 5, lockMinutes: 15, sessionTimeoutMinutes: 30, ipWhitelistEnabled: false, ipWhitelist: [],
};
function securityPolicy(value: unknown): TenantSecurityPolicy {
  const raw = (value ?? {}) as Record<string, unknown>;
  const switches = (raw.switches ?? {}) as Record<string, unknown>;
  const numberIn = (field: unknown, fallback: number) => Number(String(field ?? '').match(/\d+/)?.[0] ?? fallback);
  const legacyComplexity = String(raw.pwdComplexity ?? '');
  const passwordComplexity = String(raw.passwordComplexity ?? '') as PasswordComplexity;
  const whitelist = Array.isArray(raw.ipWhitelist) ? raw.ipWhitelist.map(String) : String(raw.ipWhitelist ?? '').split(/[\s,;]+/).filter(Boolean);
  return {
    passwordMinLength: Math.max(10, numberIn(raw.passwordMinLength ?? raw.pwdMinLen, 10)),
    passwordComplexity: ['letters_numbers', 'upper_lower_numbers', 'upper_lower_numbers_symbols'].includes(passwordComplexity)
      ? passwordComplexity : legacyComplexity.includes('符号') ? 'upper_lower_numbers_symbols' : legacyComplexity.includes('大小写') ? 'upper_lower_numbers' : 'letters_numbers',
    passwordExpiryDays: raw.passwordExpiryDays === null || raw.pwdExpiry === '永久' ? null : numberIn(raw.passwordExpiryDays ?? raw.pwdExpiry, 90),
    lockMaxAttempts: raw.lockMaxAttempts === 0 || raw.lockPolicy === '不锁定' ? 0 : numberIn(raw.lockMaxAttempts ?? raw.lockPolicy, 5),
    lockMinutes: numberIn(raw.lockMinutes ?? String(raw.lockPolicy ?? '').match(/锁\s*(\d+)/)?.[1], 15),
    sessionTimeoutMinutes: raw.sessionTimeoutMinutes === null || switches.sessionTimeout === false ? null : numberIn(raw.sessionTimeoutMinutes, 30),
    ipWhitelistEnabled: raw.ipWhitelistEnabled === true || switches.ipWhitelist === true,
    ipWhitelist: whitelist,
  };
}

const PAY_TYPE: Record<string, string> = { WECHAT: '微信扫码', ALIPAY: '支付宝扫码', BANK_TRANSFER: '对公转账' };
const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: '待支付', cls: 'badge-warning' },
  PENDING_VERIFICATION: { label: '待核销', cls: 'badge-warning' },
  PAID: { label: '已支付', cls: 'badge-success' },
  CANCELLED: { label: '已取消', cls: 'badge-neutral' },
  EXPIRED: { label: '已过期', cls: 'badge-neutral' },
};
const fmtPrice = (n: number) => '¥' + (n / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 });

export default function Settings() {
  const [tab, setTab] = usePageTab('basic', ["basic","plan","admins","security"] as const, 'tab');
  const [tenant, setTenant] = useState<{ id: string; name: string; status: string; adminEmail: string; cycleStartAt: string; subscriptionEnd?: string; pendingSubscription?: { planId: string; start: string; end: string }; aiQuotaUsed: number; monthCalls: number; isTrial: boolean } | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [resourceUsage, setResourceUsage] = useState({ robots: 0, users: 0, knowledgeBases: 0, channels: 0, groups: 0, storageMb: 0 });
  const [, setPrefs] = useState<Record<string, unknown>>({});
  const [msg, setMsg] = useFeedback();
  const [threshold1, setThreshold1] = useState('70');
  const [threshold2, setThreshold2] = useState('90');
  // 支付
  const [payOrder, setPayOrder] = useState<PayOrder | null>(null);
  const [payPlan, setPayPlan] = useState<Plan | null>(null);
  const [payType, setPayType] = useState<'WECHAT' | 'ALIPAY' | 'BANK_TRANSFER'>('WECHAT');
  const [payEffectType, setPayEffectType] = useState<'IMMEDIATE' | 'NEXT_CYCLE'>('IMMEDIATE');
  const [paying, setPaying] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [bankRemark, setBankRemark] = useState('');
  const [records, setRecords] = useState<PayOrder[]>([]);
  const [loadError, setLoadError] = useState('');
  // 管理人员（真实账号 CRUD）
  const [accounts, setAccounts] = useState<TenantAccountView[]>([]);
  const [accountRoles, setAccountRoles] = useState<TenantRole[]>([]);
  const [showAcc, setShowAcc] = useState(false);
  const [accEditId, setAccEditId] = useState('');
  const emptyAcc = () => ({ name: '', account: '', password: '', roleId: accountRoles.find((role) => role.name === '运营')?.id ?? accountRoles[0]?.id ?? '' });
  const [accForm, setAccForm] = useState(emptyAcc());
  // 安全策略 + 登录日志（config.security 经 preferences 端点读写）
  const [security, setSecurity] = useState<TenantSecurityPolicy>(DEFAULT_SECURITY);
  const [loginLogs, setLoginLogs] = useState<Array<{ id: string; account: string; ip: string; result: string; createdAt: string }>>([]);

  /** 后台功能权限名称；授权本身只在角色权限中心维护。 */
  const WINDOWS: Array<{ key: string; label: string }> = [
    { key: 'dashboard', label: '工作台' }, { key: 'notifications', label: '通知' },
    { key: 'robots', label: '机器人管理' }, { key: 'channels', label: '渠道接入' },
    { key: 'groups', label: '群管理' }, { key: 'messages', label: '消息测试' },
    { key: 'broadcast', label: '消息发送' }, { key: 'follow-ups', label: '待跟进' },
    { key: 'sessions', label: '会话管理' }, { key: 'users', label: '用户管理' },
    { key: 'roles', label: '角色权限' }, { key: 'knowledge', label: '知识库' },
    { key: 'tools', label: '外部接口' }, { key: 'audit', label: '审计中心' },
    { key: 'logs', label: '操作日志' }, { key: 'settings', label: '租户管理' },
  ];

  async function load() {
    try {
      const d = await api<{ tenant: typeof tenant; plan: Plan; plans: Plan[]; preferences: Record<string, unknown>; resourceUsage: typeof resourceUsage }>(`/api/v1/tenant/profile?tenantId=${TID}`);
      setTenant(d.tenant); setPlan(d.plan); setPlans(d.plans); setPrefs(d.preferences ?? {});
      setResourceUsage(d.resourceUsage);
      setThreshold1(String((d.preferences?.threshold1 as string) ?? '70'));
      setThreshold2(String((d.preferences?.threshold2 as string) ?? '90'));
      // 支付记录（api() 已解包 body.data → 直接是数组，勿再取 .data）
      const r = await api<PayOrder[]>(`/api/v1/tenant/payments?tenantId=${TID}`);
      setRecords(Array.isArray(r) ? r : []);
      // 管理人员 + 登录日志（真实账号体系）
      setAccounts(await api<TenantAccountView[]>(`/api/v1/tenant/accounts?tenantId=${TID}`));
      setAccountRoles(await api<TenantRole[]>(`/api/v1/tenant/accounts/assignable-roles?tenantId=${TID}`));
      setLoginLogs(await api<Array<{ id: string; account: string; ip: string; result: string; createdAt: string }>>(`/api/v1/tenant/accounts/login-logs?tenantId=${TID}&limit=20`));
      setSecurity(securityPolicy(d.preferences?.security));
      setLoadError('');
    } catch (cause) {
      setLoadError('部分设置未能加载：' + (cause as Error).message + '。请重试，未加载的数据不可作为当前状态。');
    }
  }
  useEffect(() => { load(); }, []);

  const pollingOrderId = payOrder?.id;
  const shouldPollPayment = !!pollingOrderId && payType !== 'BANK_TRANSFER' && payOrder?.status === 'PENDING';

  // 扫码订单只能由验签后的支付网关回调入账；弹窗内轮询展示最终状态。
  useEffect(() => {
    if (!pollingOrderId || !shouldPollPayment) return;
    const id = pollingOrderId;
    const timer = window.setInterval(async () => {
      try {
        const latest = await api<PayOrder>(`/api/v1/tenant/payments/${id}`);
        setPayOrder((current) => current?.id === id ? latest : current);
        if (latest.status === 'PAID') {
          window.clearInterval(timer);
          setMsg('✅ 支付成功，套餐已按订单安排生效，请查看当前周期及预约信息');
          setPayOrder(null); setPayPlan(null); setQrDataUrl('');
          load();
        }
      } catch { /* 临时网络抖动由下一次轮询恢复，不误报支付失败。 */ }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [pollingOrderId, shouldPollPayment]);

  async function savePrefs() {
    await api(`/api/v1/tenant/profile/preferences?tenantId=${TID}`, { method: 'PUT', body: JSON.stringify({ preferences: { threshold1, threshold2, notifyWays: ['站内通知'], notifyTarget: '租户通知中心' } }) });
    setMsg('✅ 预警配置已保存');
  }

  /** 保存安全策略（config.security，走现有 preferences 端点合并写入） */
  async function saveSecurity() {
    try {
      await api(`/api/v1/tenant/profile/preferences?tenantId=${TID}`, { method: 'PUT', body: JSON.stringify({ preferences: { security } }) });
      setMsg('✅ 安全策略已保存（写审计；平台策略为基线，租户可收紧）');
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function loadAccounts() {
    const [accountRows, roleRows] = await Promise.all([
      api<TenantAccountView[]>(`/api/v1/tenant/accounts?tenantId=${TID}`),
      api<TenantRole[]>(`/api/v1/tenant/accounts/assignable-roles?tenantId=${TID}`),
    ]);
    setAccounts(accountRows); setAccountRoles(roleRows);
  }

  function passwordError(password: string): string | null {
    if (password.length < security.passwordMinLength || password.length > 128) return `密码需为 ${security.passwordMinLength}-128 位`;
    if (!/[a-z]/i.test(password) || !/\d/.test(password)) return '密码必须同时包含字母和数字';
    if (security.passwordComplexity !== 'letters_numbers' && (!/[a-z]/.test(password) || !/[A-Z]/.test(password))) return '密码必须同时包含大写字母、小写字母和数字';
    if (security.passwordComplexity === 'upper_lower_numbers_symbols' && !/[^A-Za-z0-9]/.test(password)) return '密码必须包含大写字母、小写字母、数字和符号';
    return null;
  }

  async function saveAcc() {
    if (!accForm.name.trim() || !accForm.account.trim() || !accForm.roleId || (!accEditId && !accForm.password)) { setMsg('❌ 姓名/账号/初始密码/角色必填'); return; }
    const invalidPassword = accForm.password ? passwordError(accForm.password) : null;
    if (invalidPassword) { setMsg('❌ ' + invalidPassword); return; }
    try {
      const body: Record<string, unknown> = { name: accForm.name.trim(), roleId: accForm.roleId };
      if (accForm.password) body.password = accForm.password;
      if (!accEditId) body.account = accForm.account.trim();
      await api(accEditId ? `/api/v1/tenant/accounts/${accEditId}` : '/api/v1/tenant/accounts', {
        method: accEditId ? 'PATCH' : 'POST',
        body: JSON.stringify({ tenantId: TID, ...body }),
      });
      setMsg(`✅ 管理人员「${accForm.name}」已${accEditId ? '更新' : '创建'}（写审计）`);
      setShowAcc(false); loadAccounts();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  function openAccEdit(a: TenantAccountView) {
    setAccEditId(a.id);
    setAccForm({ name: a.name, account: a.account, password: '', roleId: a.roleId ?? '' });
    setShowAcc(true);
  }

  async function resetAccPwd(a: TenantAccountView) {
    const pwd = window.prompt(`为「${a.name}」设置新密码（10-128 位，含字母和数字）：`);
    if (!pwd) return;
    const invalidPassword = passwordError(pwd);
    if (invalidPassword) { setMsg('❌ ' + invalidPassword); return; }
    try {
      await api(`/api/v1/tenant/accounts/${a.id}`, { method: 'PATCH', body: JSON.stringify({ tenantId: TID, password: pwd }) });
      setMsg(`✅ 「${a.name}」密码已重置（写审计）`);
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function toggleAccStatus(a: TenantAccountView) {
    try {
      await api(`/api/v1/tenant/accounts/${a.id}`, { method: 'PATCH', body: JSON.stringify({ tenantId: TID, status: a.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }) });
      setMsg(`✅ 「${a.name}」已${a.status === 'ACTIVE' ? '禁用（无法登录）' : '启用'}`);
      loadAccounts();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function removeAcc(a: TenantAccountView) {
    if (!(await confirmAction(`确认删除管理人员「${a.name}」？（不可恢复；至少保留一名启用管理员）`, { confirmText: '确认删除' }))) return;
    try {
      await api(`/api/v1/tenant/accounts/${a.id}?tenantId=${TID}`, { method: 'DELETE' });
      setMsg(`✅ 已删除「${a.name}」`);
      loadAccounts();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  /** 创建支付订单 → 展示二维码/对公转账信息 */
  async function createOrder(p: Plan, effectType: 'IMMEDIATE' | 'NEXT_CYCLE' = 'IMMEDIATE') {
    setPaying(true); setPayPlan(p); setPayEffectType(effectType); setBankRemark(''); setMsg('');
    try {
      const r = await api<PayOrder & { directSwitch?: boolean; message?: string }>(`/api/v1/tenant/payments?tenantId=${TID}`, {
        method: 'POST', body: JSON.stringify({ tenantId: TID, planId: p.id, payType, effectType }),
      });
      if (r.directSwitch) { setMsg(r.message ?? '✅ 已切换套餐'); load(); return; }
      setPayOrder(r);
      if (r.qrContent) setQrDataUrl(await QRCode.toDataURL(r.qrContent, { width: 200, margin: 1 }));
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
    finally { setPaying(false); }
  }

  /** 切换支付方式（重建订单） */
  async function switchPayType(t: 'WECHAT' | 'ALIPAY' | 'BANK_TRANSFER') {
    if (!payPlan || t === payType) return;
    setPayType(t);
    try {
      if (payOrder?.status === 'PENDING') {
        await api(`/api/v1/tenant/payments/${payOrder.id}/cancel`, { method: 'POST' });
      }
      const r = await api<PayOrder>(`/api/v1/tenant/payments?tenantId=${TID}`, {
        method: 'POST', body: JSON.stringify({ tenantId: TID, planId: payPlan.id, payType: t, effectType: payEffectType }),
      });
      setPayOrder(r);
      setBankRemark('');
      setQrDataUrl('');
      if (r.qrContent) setQrDataUrl(await QRCode.toDataURL(r.qrContent, { width: 200, margin: 1 }));
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  /** 对公转账提交待核销；扫码支付不允许由浏览器手工确认。 */
  async function confirmPay() {
    if (!payOrder) return;
    try {
      await api<PayOrder>(`/api/v1/tenant/payments/${payOrder.id}/confirm`, { method: 'POST', body: JSON.stringify({ remark: bankRemark.trim() || undefined }) });
      setMsg('✅ 已提交转账信息，等待平台核销后套餐生效');
      setPayOrder(null); setPayPlan(null); setQrDataUrl(''); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function cancelOrder() {
    if (!payOrder) return;
    await api(`/api/v1/tenant/payments/${payOrder.id}/cancel`, { method: 'POST' });
    setPayOrder(null); setPayPlan(null); setQrDataUrl(''); load();
  }

  const currentUsage = (key: 'robotLimit' | 'userLimit' | 'kbLimit' | 'channelLimit', used: number) => {
    const max = plan?.[key] ?? 0;
    return max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  };
  const selectedAccountRole = accountRoles.find((role) => role.id === accForm.roleId);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>租户设置</h1>
          <div className="desc">基本信息 · 套餐与额度 · 管理人员 · 安全策略（区别于平台侧设置）</div>
        </div>
      </div>

      {msg && <Feedback message={msg} />}
      {loadError && <div role="alert" style={{ marginBottom: 12 }}><Feedback message={loadError} /><AsyncButton className="btn btn-secondary" onClick={load}>重新加载设置</AsyncButton></div>}

      <TabBar name="tab" items={[["basic","基本信息"],["plan","套餐额度"],["admins","管理人员"],["security","安全设置"]] as const} value={tab} onChange={setTab} />

      <TabPanel name="tab" id="basic" active={tab}><div className="card">
          <div className="card-title" style={{ marginBottom: 12 }}>基本信息</div>
          <table style={{ fontSize: 14 }}>
            <tbody>
              {[
                ['租户名称', tenant?.name ?? '—'],
                ['租户 ID', tenant?.id ?? '—'],
                ['管理员账号', tenant?.adminEmail ?? '—'],
                ['当前套餐', plan?.name ?? '—'],
                ['套餐周期', tenant?.cycleStartAt ? `${tenant.cycleStartAt} ～ ${tenant.subscriptionEnd ?? '自动续期'}` : '—'],
                ['试用', tenant?.isTrial ? '是' : '否'],
                ['状态', tenant?.status ?? '—'],
              ].map(([k, v]) => (
                <tr key={k}><td className="muted" style={{ width: 120, padding: '8px 0' }}>{k}</td><td style={{ padding: '8px 0' }}>{v}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="small muted" style={{ marginTop: 12 }}>停用/注销服务需联系平台管理员处理（生命周期正反向验证由平台执行）</div>
        </div></TabPanel>

      <TabPanel name="tab" id="plan" active={tab}><>
          <label>付款方式 <select className="select" value={payType} disabled={paying || !!payOrder} onChange={e => setPayType(e.target.value as typeof payType)}><option value="WECHAT">微信</option><option value="ALIPAY">支付宝</option><option value="BANK_TRANSFER">对公转账</option></select></label>
          <p>服务有效至：{tenant?.subscriptionEnd ?? '待核对'}（当日零点到期）。未续费暂停新增资源和机器人调用，已有数据保留。</p>
          {tenant?.pendingSubscription && <p role="status">已预约：{plans.find(p => p.id === tenant.pendingSubscription?.planId)?.name ?? '下一周期套餐'}，{tenant.pendingSubscription.start} 至 {tenant.pendingSubscription.end} 生效。</p>}
          <p className="small">按受理次数计费，失败仍计次。立即升级开启新周期并清零用量；续费和下周期换套餐按完整周期价格支付，生效时重置额度。</p>
          {/* 套餐卡（对齐原型：价格 + 特性 + 当前标记 + 升级/选择按钮） */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
            {plans.map((p) => {
              const isCurrent = plan?.id === p.id;
              return (
                <div key={p.id} className="card" style={{ ...(isCurrent ? { border: '2px solid var(--primary)' } : {}), position: 'relative' }}>
                  {isCurrent && <span className="badge badge-info" style={{ position: 'absolute', top: 10, right: 10 }}>当前</span>}
                  {p.isFeatured && !isCurrent && <span className="badge badge-info" style={{ position: 'absolute', top: 10, right: 10 }}>主推</span>}
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{p.name}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--primary)', marginBottom: 10 }}>
                    {p.price > 0 ? `¥${p.price.toLocaleString()}` : '¥0'} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>/ {p.validityDays ?? 30} 天</span>
                  </div>
                  <div className="small" style={{ lineHeight: 1.8, color: 'var(--text-secondary)', marginBottom: 12 }}>
                    {p.robotLimit > 0 ? `${p.robotLimit} 机器人` : '不限机器人'} · {p.aiQuota > 0 ? `${p.aiQuota.toLocaleString()} 次/${p.validityDays ?? 30} 天` : '不限调用'}<br />
                    {p.channelLimit > 0 ? `${p.channelLimit} 渠道` : '全渠道'} · {p.kbLimit > 0 ? `${p.kbLimit} 知识库` : '不限知识库'}<br />
                    <b>知识库总容量 {p.storageLimitMb > 0 ? `${p.storageLimitMb}MB` : '不限'}</b> · {p.adminWindowLimit > 0 ? `最多管理 ${p.adminWindowLimit} 个群` : '管理群数不限'}
                  </div>
                  {isCurrent
                    ? <AsyncButton className="btn btn-secondary btn-sm" disabled={paying || !!tenant?.pendingSubscription} onClick={() => createOrder(p, 'NEXT_CYCLE')}>续费当前套餐</AsyncButton>
                    : p.price < (plan?.price ?? 0)
                      ? <AsyncButton className="btn btn-secondary btn-sm" disabled={paying || !!tenant?.pendingSubscription} onClick={() => createOrder(p, 'NEXT_CYCLE')}>预约到期换套餐</AsyncButton>
                      : <AsyncButton className="btn btn-primary btn-sm" style={{ width: '100%' }} disabled={paying || !!tenant?.pendingSubscription} onClick={() => createOrder(p)}>
                          {p.price > (plan?.price ?? 0) ? '升级' : '选择'}
                      </AsyncButton>}
                </div>
              );
            })}
            {plans.length === 0 && <div className="card small muted">暂无可用套餐</div>}
          </div>
          <div className="small muted" style={{ marginBottom: 16 }}>📄 资源创建、上传容量和 AI 调用均由套餐后台校验；到期后保留查看和续费权限，新增资源与机器人回答会暂停。</div>

          {/* 用量进度（对齐原型：AI 调用额度 + 进度条） */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title" style={{ marginBottom: 8 }}>本周期用量（{plan?.validityDays ?? 30} 天）</div>
            <div className="small muted" style={{ margin: '4px 0 6px' }}>
              本周期已用 {tenant?.monthCalls ?? 0} / {plan?.aiQuota && plan.aiQuota > 0 ? plan.aiQuota.toLocaleString() : '不限'} 次（{plan?.aiQuota && plan.aiQuota > 0 ? Math.round(((tenant?.monthCalls ?? 0) / plan.aiQuota) * 100) : 0}%）
            </div>
            <div style={{ height: 8, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden', marginBottom: 14 }}>
              <div style={{ width: `${plan?.aiQuota && plan.aiQuota > 0 ? Math.min(100, Math.round(((tenant?.monthCalls ?? 0) / plan.aiQuota) * 100)) : 0}%`, height: '100%', background: 'var(--primary)', borderRadius: 4 }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              {[
                { label: '机器人配额', used: resourceUsage.robots, max: plan?.robotLimit ?? 0 },
                { label: '用户配额', used: resourceUsage.users, max: plan?.userLimit ?? 0 },
                { label: '知识库配额', used: resourceUsage.knowledgeBases, max: plan?.kbLimit ?? 0 },
                { label: '渠道配额', used: resourceUsage.channels, max: plan?.channelLimit ?? 0 },
                { label: '已启用的管理群', used: resourceUsage.groups ?? 0, max: plan?.adminWindowLimit ?? 0 },
                { label: '知识文件容量 MB', used: Math.ceil((resourceUsage.storageMb ?? 0) * 100) / 100, max: plan?.storageLimitMb ?? 0 },
              ].map((it) => (
                <div key={it.label}>
                  <div className="small" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span>{it.label}</span><span className="muted">{it.used}/{it.max > 0 ? it.max : '不限'}</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--bg-hover)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${currentUsage(it.label === '机器人配额' ? 'robotLimit' : it.label === '用户配额' ? 'userLimit' : it.label === '知识库配额' ? 'kbLimit' : 'channelLimit', it.used)}%`, height: '100%', background: 'var(--primary)', borderRadius: 3 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 超限预警配置（对齐原型：阈值 1/2 + 通知方式多选 + 通知对象） */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title" style={{ marginBottom: 12 }}>超限预警配置（覆盖平台默认阈值，租户可自定义）</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <div>
                <div className="small" style={{ marginBottom: 4 }}>预警阈值 1（提醒）</div>
                <select className="select" value={threshold1} onChange={(e) => setThreshold1(e.target.value)}>
                  {['60', '70', '80', '90'].map((v) => <option key={v} value={v}>{v}%</option>)}
                </select>
              </div>
              <div>
                <div className="small" style={{ marginBottom: 4 }}>预警阈值 2（强提醒）</div>
                <select className="select" value={threshold2} onChange={(e) => setThreshold2(e.target.value)}>
                  {['80', '90', '95', '100'].map((v) => <option key={v} value={v}>{v}%</option>)}
                </select>
              </div>
            </div>
            <p className="small muted">额度预警发送到租户通知中心，具备通知查看权限的后台人员可见；每个计费周期每档阈值提醒一次。邮件、企微及指定人员投递暂未接通。</p>
            <AsyncButton className="btn btn-primary btn-sm" onClick={savePrefs}>保存预警配置</AsyncButton>
          </div>

          {/* 支付记录（支持查看支付记录） */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 12 }}>支付记录</div>
            <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
              <thead><tr><th>时间</th><th>套餐</th><th>金额</th><th>支付方式</th><th>状态</th><th>备注</th></tr></thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td className="muted small">{fmtDateTime(r.createdAt || '')}</td>
                    <td className="cell-strong">{r.planName}</td>
                    <td style={{ fontWeight: 600 }}>{fmtPrice(r.amount)}</td>
                    <td className="small">{PAY_TYPE[r.payType] ?? r.payType}</td>
                    <td><span className={`badge ${ORDER_STATUS[r.status]?.cls ?? 'badge-neutral'}`}>{ORDER_STATUS[r.status]?.label ?? r.status}</span></td>
                    <td className="muted small">{r.remark ?? '—'}</td>
                  </tr>
                ))}
                {records.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 24 }}>暂无支付记录</td></tr>}
              </tbody>
            </table></div>
          </div>
        </></TabPanel>

      <TabPanel name="tab" id="admins" active={tab}><>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div className="card-title">管理人员与角色</div>
                <div className="small muted" style={{ marginTop: 4 }}>账号绑定角色后，后台菜单与接口权限统一由角色控制。</div>
              </div>
              <AsyncButton className="btn btn-primary btn-sm" onClick={() => { setAccForm(emptyAcc()); setAccEditId(''); setShowAcc(true); }}>+ 添加管理人员</AsyncButton>
            </div>
            <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
              <thead><tr><th>姓名</th><th>登录账号</th><th>角色</th><th>可管理窗口</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td className="cell-strong">{a.name}</td>
                    <td className="muted small">{a.account}</td>
                    <td><span className={`badge ${!a.roleAvailable ? 'badge-warning' : a.role === 'TENANT_ADMIN' ? 'badge-info' : 'badge-neutral'}`}>{a.roleName}</span></td>
                    <td className="muted small" title={a.windows.map((key) => WINDOWS.find((item) => item.key === key)?.label ?? key).join('、')}>
                      {a.windows.length === WINDOWS.length ? '全部窗口' : `${a.windows.length} 个窗口`}
                    </td>
                    <td><span className={`badge ${a.status === 'ACTIVE' ? 'badge-success' : 'badge-warning'}`}>{a.status === 'ACTIVE' ? '正常' : '已禁用'}</span></td>
                    <td className="muted small">{a.lastLoginAt ? fmtDateTime(String(a.lastLoginAt)) : '从未登录'}</td>
                    <td className="cell-actions" style={{ whiteSpace: 'nowrap' }}>
                      <AsyncButton className="link" onClick={() => openAccEdit(a)}>编辑</AsyncButton>
                      <AsyncButton className="link" style={{ marginLeft: 8 }} onClick={() => resetAccPwd(a)}>重置密码</AsyncButton>
                      <AsyncButton className="link" style={{ marginLeft: 8 }} onClick={() => toggleAccStatus(a)}>{a.status === 'ACTIVE' ? '禁用' : '启用'}</AsyncButton>
                      <AsyncButton className="link danger" style={{ marginLeft: 8 }} onClick={() => removeAcc(a)}>删除</AsyncButton>
                    </td>
                  </tr>
                ))}
                {accounts.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 24 }}>暂无管理账号，请先创建一名租户管理员。</td></tr>
                )}
              </tbody>
            </table></div>
            <div className="small muted" style={{ marginTop: 12 }}>
              功能授权请在 <Link className="link" to="/t/roles">角色权限</Link> 中统一配置；租户至少保留一名启用状态的内置管理员。
            </div>
          </div>

          {/* 添加/编辑弹窗：账号只绑定角色，功能权限由角色中心统一配置。 */}
          {showAcc && (
            <ModalFrame title={accEditId ? '编辑管理人员' : '新增管理人员'} onClose={() => { setShowAcc(false); }}>
              <div className="card" style={{ width: 480, maxWidth: '94vw', maxHeight: '86vh', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div className="card-title">{accEditId ? `编辑 — ${accForm.name}` : '添加管理人员'}</div>
                  <AsyncButton closeDialog style={{ cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)' }} onClick={() => setShowAcc(false)}>✕</AsyncButton>
                </div>
                <div className="small" style={{ marginBottom: 6, fontWeight: 500 }}>姓名 *</div>
                <input className="input" style={{ width: '100%', marginBottom: 10 }} value={accForm.name} onChange={(e) => setAccForm({ ...accForm, name: e.target.value })} />
                <div className="small" style={{ marginBottom: 6, fontWeight: 500 }}>登录账号 *（邮箱，全局唯一）</div>
                <input className="input" style={{ width: '100%', marginBottom: 10 }} disabled={!!accEditId} value={accForm.account} onChange={(e) => setAccForm({ ...accForm, account: e.target.value })} placeholder="ops@example.com" />
                <div className="small" style={{ marginBottom: 6, fontWeight: 500 }}>{accEditId ? '重置密码（留空则不修改）' : '初始密码 *'}</div>
                <input className="input" type="password" style={{ width: '100%', marginBottom: 10 }} value={accForm.password} onChange={(e) => setAccForm({ ...accForm, password: e.target.value })} placeholder={accEditId ? '留空保持不变' : `${security.passwordMinLength}-128 位，遵循当前安全策略`} />
                <div className="small" style={{ marginBottom: 6, fontWeight: 500 }}>关联角色 *</div>
                <select className="select" style={{ width: '100%', marginBottom: 8 }} value={accForm.roleId} onChange={(e) => setAccForm({ ...accForm, roleId: e.target.value })}>
                  <option value="">请选择角色</option>
                  {accountRoles.map((role) => <option key={role.id} value={role.id}>{role.name}{role.isBuiltin ? '（内置）' : ''}</option>)}
                </select>
                <div className="account-role-summary">
                  <span className="small muted">当前角色功能权限</span>
                  <strong>{selectedAccountRole?.windowPermissions.length ?? 0} 项</strong>
                  <span className="small muted">
                    {selectedAccountRole?.windowPermissions.length
                      ? selectedAccountRole.windowPermissions.map((key) => WINDOWS.find((item) => item.key === key)?.label ?? key).join('、')
                      : '该角色暂未配置管理后台功能'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <AsyncButton closeDialog className="btn btn-secondary" onClick={() => setShowAcc(false)}>取消</AsyncButton>
                  <AsyncButton className="btn btn-primary" onClick={saveAcc}>{accEditId ? '保存' : '创建'}</AsyncButton>
                </div>
              </div>
            </ModalFrame>
          )}
        </></TabPanel>

      <TabPanel name="tab" id="security" active={tab}><div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="card-title">安全设置（租户策略 · 平台基线上可收紧）</div>
            <AsyncButton className="btn btn-primary btn-sm" onClick={saveSecurity}>保存安全策略</AsyncButton>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <div className="small" style={{ marginBottom: 4 }}>密码最小长度</div>
              <select className="select" style={{ width: '100%' }} value={security.passwordMinLength} onChange={(e) => setSecurity({ ...security, passwordMinLength: Number(e.target.value) })}>
                {[10, 12, 14, 16].map((v) => <option key={v} value={v}>{v} 位</option>)}
              </select>
            </div>
            <div>
              <div className="small" style={{ marginBottom: 4 }}>密码复杂度</div>
              <select className="select" style={{ width: '100%' }} value={security.passwordComplexity} onChange={(e) => setSecurity({ ...security, passwordComplexity: e.target.value as PasswordComplexity })}>
                <option value="letters_numbers">字母 + 数字</option><option value="upper_lower_numbers">大小写 + 数字</option><option value="upper_lower_numbers_symbols">大小写 + 数字 + 符号</option>
              </select>
            </div>
            <div>
              <div className="small" style={{ marginBottom: 4 }}>密码有效期</div>
              <select className="select" style={{ width: '100%' }} value={security.passwordExpiryDays ?? 0} onChange={(e) => setSecurity({ ...security, passwordExpiryDays: Number(e.target.value) || null })}>
                <option value={90}>90 天</option><option value={180}>180 天</option><option value={365}>365 天</option><option value={0}>永久</option>
              </select>
            </div>
            <div>
              <div className="small" style={{ marginBottom: 4 }}>登录失败锁定</div>
              <select className="select" style={{ width: '100%' }} value={`${security.lockMaxAttempts}:${security.lockMinutes}`} onChange={(e) => {
                const [lockMaxAttempts, lockMinutes] = e.target.value.split(':').map(Number);
                setSecurity({ ...security, lockMaxAttempts, lockMinutes });
              }}>
                <option value="5:15">5 次锁 15 分钟</option><option value="10:30">10 次锁 30 分钟</option><option value="0:15">不锁定</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label className="flex gap-3" style={{ gap: 6, fontSize: 13, cursor: 'pointer', marginBottom: 6 }}>
                <input type="checkbox" checked={security.sessionTimeoutMinutes !== null} onChange={() => setSecurity({ ...security, sessionTimeoutMinutes: security.sessionTimeoutMinutes === null ? 30 : null })} style={{ accentColor: 'var(--primary)' }} />
                会话超时自动退出
              </label>
              <select className="select" style={{ width: '100%' }} disabled={security.sessionTimeoutMinutes === null} value={security.sessionTimeoutMinutes ?? 30} onChange={(e) => setSecurity({ ...security, sessionTimeoutMinutes: Number(e.target.value) })}>
                <option value={15}>15 分钟</option><option value={30}>30 分钟</option><option value={60}>60 分钟</option><option value={120}>2 小时</option><option value={480}>8 小时</option>
              </select>
            </div>
            <div>
              <label className="flex gap-3" style={{ gap: 6, fontSize: 13, cursor: 'pointer', marginBottom: 6 }}>
                <input type="checkbox" checked={security.ipWhitelistEnabled} onChange={() => setSecurity({ ...security, ipWhitelistEnabled: !security.ipWhitelistEnabled })} style={{ accentColor: 'var(--primary)' }} />
                IP 白名单
              </label>
              <textarea className="input" rows={3} style={{ width: '100%', resize: 'vertical' }} disabled={!security.ipWhitelistEnabled} value={security.ipWhitelist.join('\n')} onChange={(e) => setSecurity({ ...security, ipWhitelist: e.target.value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean) })} placeholder={'每行一个 IP 或 IPv4 CIDR\n例如：203.0.113.10\n10.0.0.0/24'} />
            </div>
          </div>
          <div className="ai-warning info" style={{ marginBottom: 16 }}>
            上述策略已接入登录、改密和刷新会话链路。启用 IP 白名单时必须包含当前访问 IP，系统会在保存前防止管理员把自己锁在后台外。MFA 需要逐账号扫码绑定，将在下一安全闭环中开放，当前不会显示为已启用。
          </div>
          <div className="card-sub" style={{ margin: '12px 0 8px' }}>登录日志（最近 5 条 · 真实记录）</div>
          <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
            <thead><tr><th>时间</th><th>账号</th><th>IP</th><th>结果</th></tr></thead>
            <tbody>
              {loginLogs.slice(0, 5).map((l) => (
                <tr key={l.id}>
                  <td className="muted small">{fmtDateTime(l.createdAt)}</td>
                  <td className="small">{l.account}</td>
                  <td className="muted small" style={{ fontFamily: 'monospace' }}>{l.ip}</td>
                  <td><span className={`badge ${l.result === '成功' ? 'badge-success' : 'badge-error'}`}>{l.result}</span></td>
                </tr>
              ))}
              {loginLogs.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 20 }}>暂无登录记录</td></tr>}
            </tbody>
          </table></div>
        </div></TabPanel>

      {/* 支付弹窗（选方式 → 二维码/对公转账 → 确认支付） */}
      {payOrder && (
        <ModalFrame title="套餐支付 —" onClose={() => { setPayOrder(null); }}>
          <div className="card" style={{ width: 440, maxWidth: '94vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="card-title">套餐支付 — {payOrder.planName}</div>
              <AsyncButton closeDialog style={{ cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)' }} onClick={() => setPayOrder(null)}>✕</AsyncButton>
            </div>
            <div style={{ textAlign: 'center', marginBottom: 14 }}>
              <div className="small muted">应付金额（差额按天折算）</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--primary)' }}>{fmtPrice(payOrder.amount)}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {([['WECHAT', '💚 微信扫码'], ['ALIPAY', '💙 支付宝扫码'], ['BANK_TRANSFER', '🏦 对公转账']] as const).map(([t, label]) => (
                <AsyncButton key={t} className={`btn btn-sm ${payType === t ? 'btn-primary' : 'btn-secondary'}`} style={{ flex: 1 }} onClick={() => switchPayType(t)}>{label}</AsyncButton>
              ))}
            </div>

            {payType === 'BANK_TRANSFER' ? (
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
                <div className="small" style={{ fontWeight: 600, marginBottom: 8 }}>对公账户信息（转账时请备注订单号）</div>
                {[
                  ['户名', payOrder.bankInfo?.accountName ?? '—'],
                  ['账号', payOrder.bankInfo?.accountNo ?? '—'],
                  ['开户行', payOrder.bankInfo?.bank ?? '—'],
                  ['订单号', payOrder.id.slice(0, 12) + '…'],
                ].map(([k, v]) => (
                  <div key={k} className="small" style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                    <span className="muted">{k}</span><span style={{ fontFamily: 'monospace' }}>{v}</span>
                  </div>
                ))}
                <input className="input" style={{ width: '100%', marginTop: 10 }} placeholder="转账备注（订单号），方便平台核对" value={bankRemark} onChange={(e) => setBankRemark(e.target.value)} />
              </div>
            ) : (
              <div style={{ textAlign: 'center', marginBottom: 14 }}>
                {qrDataUrl ? (
                  <>
                    <img src={qrDataUrl} alt="支付二维码" style={{ width: 180, height: 180, border: '1px solid var(--border)', borderRadius: 8 }} />
                    <div className="small muted" style={{ marginTop: 6 }}>{payType === 'WECHAT' ? '使用微信扫一扫' : '使用支付宝扫一扫'}</div>
                  </>
                ) : <div className="small muted" style={{ padding: 40 }}>生成二维码中…</div>}
                <div className="small" style={{ color: 'var(--text-muted)', marginTop: 8 }}>支付结果由支付平台安全回调确认，本页面会自动刷新状态。</div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <AsyncButton className="btn btn-secondary" onClick={cancelOrder}>取消订单</AsyncButton>
              {payType === 'BANK_TRANSFER'
                ? <AsyncButton className="btn btn-primary" onClick={confirmPay}>我已转账</AsyncButton>
                : <AsyncButton className="btn btn-primary" disabled>等待支付结果…</AsyncButton>}
            </div>
          </div>
        </ModalFrame>
      )}
    </>
  );
}
