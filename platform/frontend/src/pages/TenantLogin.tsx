import { useFeedback, Feedback, AsyncButton } from '../components/Interaction';
import ServiceStatus from '../components/ServiceStatus';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { getAccessPayload, setAccessToken } from '../auth/token-store';

/** 租户系统登录（对齐原型 login.html）——独立于平台管理控制台 */
export default function TenantLogin() {
  const nav = useNavigate();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useFeedback();
  const [sso, setSso] = useState<{ enabled: boolean; authorizationUrl?: string | null }>({ enabled: false });

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = fragment.get('sso_token');
    const error = fragment.get('sso_error');
    if (token) {
      setAccessToken('tenant', token);
      window.history.replaceState({}, '', '/tenant-login');
      nav(
        getAccessPayload('tenant')?.mustChangePassword
          ? '/tenant-initial-password'
          : '/t/dashboard',
        { replace: true },
      );
      return;
    }
    if (error) {
      setMsg('❌ ' + error);
      window.history.replaceState({}, '', '/tenant-login');
    }
    api<{ enabled: boolean; authorizationUrl?: string | null }>('/api/v1/platform/auth/tenant/sso')
      .then(setSso).catch(() => setSso({ enabled: false }));
  }, [nav]);

  async function login() {
    try {
      const r = await api<{
        access_token: string;
        tenantId: string;
        windows?: string[];
        mustChangePassword?: boolean;
      }>('/api/v1/platform/auth/tenant/login', {
        method: 'POST',
        body: JSON.stringify({ account, password }),
      });
      setAccessToken('tenant', r.access_token);
      nav(r.mustChangePassword ? '/tenant-initial-password' : '/t/dashboard');
    } catch (e) {
      setMsg('❌ ' + (e as Error).message);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #f0f4ff, #eef1f8)' }}>
      <div className="card" style={{ width: 400, maxWidth: '92vw', padding: 32 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🤖</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>AI 机器人管理平台</div>
          <div className="small muted" style={{ marginTop: 4 }}>多租户 · 多渠道 · 企业级智能机器人</div>
        </div>
        <ServiceStatus />
        <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>账号（邮箱 / 手机号）</div>
        <input className="input" autoComplete="username" style={{ width: '100%', marginBottom: 12 }} value={account} onChange={(e) => setAccount(e.target.value)} placeholder="name@company.com" />
        <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>密码</div>
        <input className="input" autoComplete="current-password" type="password" style={{ width: '100%', marginBottom: 16 }} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="请输入密码"
          onKeyDown={(e) => e.key === 'Enter' && login()} />
        {msg && <Feedback message={msg} />}
        <AsyncButton className="btn btn-primary" style={{ width: '100%' }} onClick={login}>登 录</AsyncButton>
        <div className="small muted" style={{ textAlign: 'center', margin: '12px 0' }}>或</div>
        <AsyncButton className="btn btn-secondary" style={{ width: '100%' }} disabled={!sso.enabled}
          onClick={() => sso.authorizationUrl && window.location.assign(sso.authorizationUrl)}>
          {sso.enabled ? '使用企业 SSO 登录' : '企业 SSO 未配置'}
        </AsyncButton>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }} className="small">
          <span className="muted">忘记密码？<AsyncButton className="link" onClick={() => setMsg('请联系平台管理员重置密码')}>联系平台管理员</AsyncButton></span>
          <span className="muted">OIDC · PKCE 安全登录</span>
        </div>
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <AsyncButton className="link" onClick={() => nav('/login')}>平台管理控制台 →</AsyncButton>
        </div>
      </div>
    </div>
  );
}
