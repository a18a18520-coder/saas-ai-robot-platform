import { AsyncButton } from '../components/Interaction';
import ServiceStatus from '../components/ServiceStatus';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { setAccessToken } from '../auth/token-store';
import { getAccessPayload } from '../auth/token-store';
import { firstPlatformPath } from '../auth/platform-access';

export default function PlatformLogin() {
  const nav = useNavigate();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [mfa, setMfa] = useState('');
  const [err, setErr] = useState('');

  async function submit() {
    try {
      const res = await api<{ access_token: string }>(
        '/api/v1/platform/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({
            account,
            password,
            mfaCode: mfa || undefined,
          }),
        },
      );
      setAccessToken('platform', res.access_token);
      const session = getAccessPayload('platform');
      nav((session && firstPlatformPath(session)) || '/dashboard');
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
      }}
    >
      <div className="card" style={{ width: 400, padding: 40 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            🧭 平台管理控制台
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            SaaS 平台运营方专用 · 与租户系统隔离
          </div>
        </div>
        <ServiceStatus />
        <div style={{ marginBottom: 16 }}>
          <div
            className="small"
            style={{
              marginBottom: 6,
              color: 'var(--text-primary)',
              fontWeight: 500,
            }}
          >
            平台管理员账号
          </div>
          <input
            className="input"
            autoComplete="username"
            style={{ width: '100%' }}
            placeholder="admin@platform.local"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div
            className="small"
            style={{
              marginBottom: 6,
              color: 'var(--text-primary)',
              fontWeight: 500,
            }}
          >
            密码
          </div>
          <input
            className="input"
            style={{ width: '100%' }}
            type="password"
            placeholder="请输入密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <div
            className="small"
            style={{
              marginBottom: 6,
              color: 'var(--text-primary)',
              fontWeight: 500,
            }}
          >
            MFA 验证码（如已启用）
          </div>
          <input
            className="input"
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            style={{ width: '100%' }}
            placeholder="6 位 TOTP"
            value={mfa}
            onChange={(e) =>
              setMfa(e.target.value.replace(/\D/g, '').slice(0, 6))
            }
          />
          <div className="small muted" style={{ marginTop: 6 }}>
            内置超管配置 MFA 后必填；其他平台账号可留空
          </div>
        </div>
        {err && (
          <div className="badge badge-error" style={{ marginBottom: 12 }}>
            {err}
          </div>
        )}
        <AsyncButton
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center', height: 40 }}
          onClick={submit}
        >
          登 录
        </AsyncButton>
        <div
          className="small muted"
          style={{ textAlign: 'center', marginTop: 12 }}
        >
          固定超管受部署配置保护 · 普通账号按角色授权
        </div>
        <div className="small" style={{ textAlign: 'center', marginTop: 8 }}>
          <span className="muted">忘记密码？</span>
          <AsyncButton
            className="link"
            onClick={() => setErr('请联系平台超级管理员重置密码')}
          >
            联系平台超级管理员
          </AsyncButton>
        </div>
        <div
          style={{
            textAlign: 'center',
            marginTop: 16,
            color: 'var(--text-muted)',
            fontSize: 12,
          }}
        >
          — 独立系统 —
        </div>
        <div style={{ textAlign: 'center', marginTop: 6 }}>
          <AsyncButton className="link" onClick={() => nav('/tenant-login')}>
            租户系统登录 →
          </AsyncButton>
        </div>
      </div>
    </div>
  );
}
