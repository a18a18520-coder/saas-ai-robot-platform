import { useFeedback, AsyncButton } from '../components/Interaction';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { setAccessToken } from '../auth/token-store';

export default function TenantInitialPassword() {
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useFeedback();
  const strong =
    password.length >= 10 &&
    password.length <= 128 &&
    /[a-z]/i.test(password) &&
    /\d/.test(password);
  const matches = password === confirmation && confirmation.length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!strong) {
      setMessage('密码需为 10-128 位，且同时包含字母和数字');
      return;
    }
    if (!matches) {
      setMessage('两次输入的密码不一致');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const result = await api<{ access_token: string; tenantId: string }>(
        '/api/v1/tenant/accounts/initial-password',
        {
          method: 'POST',
          body: JSON.stringify({ password }),
        },
      );
      setAccessToken('tenant', result.access_token);
      nav('/t/dashboard', { replace: true });
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-state">
      <form className="card" onSubmit={submit}>
        <div className="auth-icon" aria-hidden="true">
          🔐
        </div>
        <h1>设置你的登录密码</h1>
        <p className="muted">
          当前使用的是平台生成的临时密码。为保护租户数据，进入后台前请设置一个仅你本人知道的新密码。
        </p>

        <div className="form-item">
          <label htmlFor="initial-new-password">新密码</label>
          <input
            id="initial-new-password"
            className="input"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            autoFocus
            value={password}
            aria-invalid={password.length > 0 && !strong}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="10-128 位，同时包含字母和数字"
          />
          <div className="f-desc">
            请勿继续使用临时密码，也不要与其他系统共用密码。
          </div>
        </div>

        <div className="form-item">
          <label htmlFor="initial-confirm-password">再次输入新密码</label>
          <input
            id="initial-confirm-password"
            className="input"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmation}
            aria-invalid={confirmation.length > 0 && !matches}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>

        <label className="flex gap-3 initial-password-toggle">
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(event) => setShowPassword(event.target.checked)}
          />
          <span className="small">显示密码</span>
        </label>

        {message && (
          <div className="ai-warning" role="alert">
            <span className="ic" aria-hidden="true">
              ⚠
            </span>
            <span>{message}</span>
          </div>
        )}

        <AsyncButton
          className="btn btn-primary"
          type="submit"
          disabled={!strong || !matches || saving}
        >
          {saving ? '保存中…' : '保存并进入租户后台'}
        </AsyncButton>
      </form>
    </div>
  );
}
