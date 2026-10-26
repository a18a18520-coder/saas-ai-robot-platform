import { useFeedback, Feedback, Tabs, AsyncButton } from '../components/Interaction';
import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface Setting {
  difyUrl: string;
  difyApiKey?: string;
  serviceAccountKey?: string;
  newTenantTrialDays: number;
  quotaThreshold: number;
  auditRetentionDays: number;
  sessionRetentionDays: number;
}

/** 平台设置（对齐原型 platform-settings.html）：Dify 连接 / 全局策略 / 安全策略（真实落库） */
export default function PlatformSettings() {
  const [form, setForm] = useState<Setting>({
    difyUrl: 'http://localhost:5001',
    newTenantTrialDays: 14,
    quotaThreshold: 80,
    auditRetentionDays: 180,
    sessionRetentionDays: 90,
  });
  const [msg, setMsg] = useFeedback();
  const [testing, setTesting] = useState(false);

  /** 测试连接 / 同步资源：真实调用 Dify 同步接口（成功即连通，platform-settings.html 双按钮） */
  async function difyAction(kind: 'test' | 'sync') {
    setTesting(true);
    setMsg('');
    try {
      const res = await api<{ total: number }>(
        '/api/v1/admin/dify/resources/sync',
      );
      setMsg(
        kind === 'test'
          ? `✅ Dify 连接正常（实例可访问，发现 ${res.total} 个 App 资源）`
          : `✅ 已同步 ${res.total} 个 Dify 资源到资源池`,
      );
    } catch (e) {
      setMsg('❌ ' + (e as Error).message + '（请检查实例地址与管理员 Key）');
    } finally {
      setTesting(false);
    }
  }

  useEffect(() => {
    api<Setting>('/api/v1/platform/settings')
      .then((d) => setForm((f) => ({ ...f, ...d })))
      .catch(() => {});
  }, []);

  async function save() {
    try {
      await api('/api/v1/platform/settings', {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      setMsg('✅ 平台设置已保存（真实落库）');
    } catch (e) {
      setMsg('❌ ' + (e as Error).message);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>平台设置</h1>
          <div className="desc">
            Dify 实例连接 · 全局策略 · 安全策略（区别于租户侧设置）
          </div>
        </div>
        <AsyncButton className="btn btn-primary" onClick={save}>
          保存
        </AsyncButton>
      </div>

      {msg && (
        <Feedback message={msg} />
      )}

      <Tabs items={[{ id: 'settings-0', label: 'Dify 连接', content: <div className="card" style={{ maxWidth: 720, marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 16 }}>
          ① Dify 实例连接
        </div>
        <div className="flex gap-3" style={{ marginBottom: 12 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="实例地址"
            value={form.difyUrl}
            onChange={(e) => setForm({ ...form, difyUrl: e.target.value })}
          />
          <AsyncButton
            className="btn btn-secondary btn-sm"
            disabled={testing}
            onClick={() => difyAction('test')}
          >
            {testing ? '测试中…' : '测试连接'}
          </AsyncButton>
          <AsyncButton
            className="btn btn-secondary btn-sm"
            disabled={testing}
            onClick={() => difyAction('sync')}
          >
            同步资源
          </AsyncButton>
        </div>
        <div
          className="small"
          style={{
            marginBottom: 6,
            color: 'var(--text-primary)',
            fontWeight: 500,
          }}
        >
          管理员 API Key（资源同步用）
        </div>
        <input
          className="input"
          type="password"
          style={{ width: '100%', marginBottom: 12 }}
          placeholder="dify 管理员 Key（控制台 → API 密钥）"
          value={form.difyApiKey ?? ''}
          onChange={(e) => setForm({ ...form, difyApiKey: e.target.value })}
        />
        <div
          className="small"
          style={{
            marginBottom: 6,
            color: 'var(--text-primary)',
            fontWeight: 500,
          }}
        >
          服务账号 Key（知识同步用）
        </div>
        <input
          className="input"
          type="password"
          style={{ width: '100%' }}
          placeholder="服务账号 Key"
          value={form.serviceAccountKey ?? ''}
          onChange={(e) =>
            setForm({ ...form, serviceAccountKey: e.target.value })
          }
        />
      </div> },
{ id: 'settings-1', label: '全局策略', content: <div className="card" style={{ maxWidth: 720, marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 16 }}>
          ② 全局策略
        </div>
        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}
        >
          <div>
            <div className="small" style={{ marginBottom: 4 }}>
              新租户默认试用期（天）
            </div>
            <input
              className="input"
              type="number"
              value={form.newTenantTrialDays}
              onChange={(e) =>
                setForm({ ...form, newTenantTrialDays: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <div className="small" style={{ marginBottom: 4 }}>
              额度预警阈值（%）
            </div>
            <input
              className="input"
              type="number"
              value={form.quotaThreshold}
              onChange={(e) =>
                setForm({ ...form, quotaThreshold: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <div className="small" style={{ marginBottom: 4 }}>
              审计保留期（天）
            </div>
            <input
              className="input"
              type="number"
              value={form.auditRetentionDays}
              onChange={(e) =>
                setForm({ ...form, auditRetentionDays: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <div className="small" style={{ marginBottom: 4 }}>
              会话保留期（天）
            </div>
            <input
              className="input"
              type="number"
              value={form.sessionRetentionDays}
              onChange={(e) =>
                setForm({
                  ...form,
                  sessionRetentionDays: Number(e.target.value),
                })
              }
            />
          </div>
        </div>
      </div> },
{ id: 'settings-2', label: '安全策略', content: <div className="card" style={{ maxWidth: 720 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>
          ③ 平台安全
        </div>
        <table style={{ fontSize: 13 }}>
          <tbody>
            {[
              ['密码策略', '平台统一策略（长度/复杂度/有效期）'],
              ['MFA 双因子', 'TOTP 动态验证码（Base32 密钥）'],
              ['登录失败锁定', '平台统一策略'],
              ['IP 白名单', '平台统一策略'],
              ['管理员账号', '固定超管 + 可配置平台角色（账号与角色页维护）'],
            ].map(([k, v]) => (
              <tr key={k}>
                <td
                  className="muted"
                  style={{ width: 130, padding: '6px 8px' }}
                >
                  {k}
                </td>
                <td style={{ padding: '6px 8px' }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div> }]} />
    </>
  );
}
