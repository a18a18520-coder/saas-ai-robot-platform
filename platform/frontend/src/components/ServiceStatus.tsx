import { useEffect, useState } from 'react';
import { readApiJson } from '../api/response';
import { AsyncButton } from './Interaction';

/** Login stays usable; dependency failures are shown before a user submits credentials. */
export default function ServiceStatus() {
  const [state, setState] = useState<'checking' | 'ready' | 'failed'>('checking');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    setState('checking');
    const base = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
    fetch(`${base}/api/v1/public/health/ready`, { signal: controller.signal })
      .then(res => readApiJson<{ status?: string; data?: { status?: string } }>(res))
      .then(body => { if (active) setState((body?.data?.status ?? body?.status) === 'ready' ? 'ready' : 'failed'); })
      .catch(() => { if (active) setState('failed'); })
      .finally(() => window.clearTimeout(timer));
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [attempt]);
  if (state === 'ready') return null;
  return <div style={{ marginBottom: 16 }} role={state === 'failed' ? 'alert' : 'status'}>
    {state === 'checking' ? <p className="small muted">正在检查服务连接…</p> : <>
      <p className="ui-form-error">暂时无法连接平台服务，请确认后端服务和数据库已启动。</p>
      <AsyncButton className="btn btn-secondary" onClick={() => setAttempt(value => value + 1)}>重新检查连接</AsyncButton>
    </>}
  </div>;
}
