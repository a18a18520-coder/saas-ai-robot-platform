import { useFeedback, Feedback, AsyncButton } from '../components/Interaction';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';

export default function TenantActivate() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useFeedback();
  const [submitting, setSubmitting] = useState(false);
  const token = params.get('token') ?? '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token) { setMessage('❌ 激活链接缺少令牌，请重新获取邮件'); return; }
    if (password.length < 10 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
      setMessage('❌ 密码需为 10-128 位且同时包含字母和数字');
      return;
    }
    if (password !== confirm) { setMessage('❌ 两次输入的密码不一致'); return; }
    setSubmitting(true); setMessage('');
    try {
      await api('/api/v1/platform/auth/tenant/activate', {
        method: 'POST', body: JSON.stringify({ token, name: name.trim(), password }),
      });
      setMessage('✅ 管理员账号已激活，即将进入登录页');
      window.setTimeout(() => nav('/tenant-login', { replace: true }), 900);
    } catch (error) {
      setMessage('❌ ' + (error as Error).message);
    } finally { setSubmitting(false); }
  }

  return (
    <div className="auth-state">
      <form className="card" style={{ width: 420, maxWidth: '92vw', padding: 32 }} onSubmit={submit}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>🔐</div>
        <h1 style={{ marginBottom: 6 }}>激活管理员账号</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>此页面仅用于兼容历史待激活租户。设置管理员姓名和登录密码后即可登录。</p>
        <div className="small" style={{ marginBottom: 6 }}>管理员姓名</div>
        <input className="input" autoComplete="name" style={{ width: '100%', marginBottom: 12 }} value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="small" style={{ marginBottom: 6 }}>登录密码</div>
        <input className="input" autoComplete="new-password" type="password" style={{ width: '100%', marginBottom: 12 }} value={password} onChange={(e) => setPassword(e.target.value)} required />
        <div className="small" style={{ marginBottom: 6 }}>确认密码</div>
        <input className="input" autoComplete="new-password" type="password" style={{ width: '100%', marginBottom: 16 }} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {message && <Feedback message={message} />}
        <AsyncButton type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={submitting || !token}>{submitting ? '正在激活…' : '激活账号'}</AsyncButton>
        <div style={{ textAlign: 'center', marginTop: 16 }}><Link className="link small" to="/tenant-login">返回租户登录</Link></div>
      </form>
    </div>
  );
}
