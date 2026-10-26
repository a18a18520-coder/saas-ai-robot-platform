import { useFeedback, PageData, Feedback, confirmAction, AsyncButton, ModalFrame } from '../../components/Interaction';
import { useEffect, useState } from 'react';
import { api, CURRENT_TENANT_ID } from '../../api/client';

const TID = CURRENT_TENANT_ID;
const API_BASE = (import.meta.env.VITE_API_BASE || window.location.origin).replace(/\/$/, '');
const WIDGET_BASE = (import.meta.env.VITE_WIDGET_BASE || window.location.origin).replace(/\/$/, '');

interface Channel { id: string; type: string; name: string; status: string; bindRobotId?: string; isActive: boolean; config?: Record<string, string> }
interface Robot { id: string; name: string }

const CHANNEL_META: Record<string, { icon: string; desc: string }> = {
  wecom: { icon: '💬', desc: '群消息 · 单聊 · 回调 · @转人工' },
  dingtalk: { icon: '📌', desc: '企业内部机器人 · Stream / HTTP 回调' },
  feishu: { icon: '📡', desc: '开放能力完善' },
  web: { icon: '🌐', desc: '嵌入网站对话窗口 · 域名白名单' },
};

export default function Channels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [robots, setRobots] = useState<Robot[]>([]);
  const [msg, setMsg] = useFeedback();
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState('wecom');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Channel | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [syncingChannel, setSyncingChannel] = useState<string | null>(null);
  const [groups, setGroups] = useState<Array<{ chatId: string; channel?: string; robotId?: string }>>([]);

  const [pageLoad, setPageLoad] = useState({ loading: true, ready: false, error: '' });
  async function load() {
    setPageLoad(old => ({ ...old, loading: true, error: '' }));
    try {
    setChannels(await api<Channel[]>(`/api/v1/tenant/channels?tenantId=${TID}`));
    setRobots(await api<Robot[]>(`/api/v1/tenant/robots?tenantId=${TID}`));
    setGroups(await api<Array<{ chatId: string; channel?: string; robotId?: string }>>(`/api/v1/tenant/groups?tenantId=${TID}`));

      setPageLoad({ loading: false, ready: true, error: '' });
    } catch (cause) { setPageLoad(old => ({ ...old, loading: false, error: (cause as Error).message })); }
  }
  useEffect(() => {
    load().catch(() => {});
    const timer = window.setInterval(() => load().catch(() => {}), 15000);
    return () => window.clearInterval(timer);
  }, []);

  async function disconnect(id: string, name: string) {
    if (!(await confirmAction(`确认停用渠道「${name}」？停用后该渠道消息不再处理`, { confirmText: '确认停用' }))) return;
    await api(`/api/v1/tenant/channels/${id}/disconnect`, { method: 'POST' });
    setMsg('✅ 渠道已停用'); load();
  }

  async function remove(id: string, name: string) {
    if (!(await confirmAction(`确认删除渠道「${name}」？此操作不可恢复`, { confirmText: '确认删除' }))) return;
    await api(`/api/v1/tenant/channels/${id}/remove`, { method: 'POST' });
    setMsg('✅ 渠道已删除'); load();
  }

  function openEditor(type: string, channel?: Channel) {
    setAddType(type);
    setConfig(channel?.config ?? (type === 'dingtalk' ? { connection_mode: 'stream' } : {}));
    setEditing(channel ?? null);
    setShowAdd(true);
  }

  async function saveChannel() {
    try {
      const c = editing
        ? await api<Channel>(`/api/v1/tenant/channels/${editing.id}/config`, { method: 'PATCH', body: JSON.stringify({ config }) })
        : await api<Channel>('/api/v1/tenant/channels', { method: 'POST', body: JSON.stringify({ tenantId: TID, type: addType, config }) });
      setMsg(`✅ 渠道「${c.name}」${editing ? '配置已更新' : '已接入'}，请测试连接后启用`);
      setShowAdd(false); setConfig({}); setEditing(null); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function test(id: string) {
    try {
      const r = await api<{ ok: boolean; message: string }>(`/api/v1/tenant/channels/${id}/test`, { method: 'POST' });
      setMsg(r.ok ? `✅ 测试通过：${r.message}` : `❌ ${r.message}`);
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function connect(id: string) {
    try {
      await api(`/api/v1/tenant/channels/${id}/connect`, { method: 'POST' });
      setMsg('✅ 渠道已连接启用'); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function bind(id: string, robotId: string) {
    await api(`/api/v1/tenant/channels/${id}/bind`, { method: 'PATCH', body: JSON.stringify({ robotId }) });
    setMsg('✅ 已绑定机器人'); load();
  }

  async function syncDirectory(channel: Channel) {
    setSyncingChannel(channel.id);
    try {
      const result = await api<{ fetched: number; created: number; updated: number }>(`/api/v1/tenant/channels/${channel.id}/sync-directory`, { method: 'POST' });
      setMsg(`✅ ${channel.name}通讯录同步完成：拉取 ${result.fetched} 人，新增 ${result.created} 人，更新 ${result.updated} 人`);
      load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
    finally { setSyncingChannel(null); }
  }

  const fields = (type: string) =>
    type === 'wecom' ? [['corp_id', 'Corp ID'], ['agent_id', 'AgentId'], ['secret', '应用 Secret'], ['token', 'Token'], ['aes_key', 'EncodingAESKey']]
    : type === 'dingtalk' ? [['app_key', 'AppKey'], ['app_secret', 'AppSecret'], ['robot_code', '机器人 Code']]
    : type === 'feishu' ? [['app_id', 'App ID'], ['app_secret', 'App Secret']]
    : [['domains', '嵌入域名（逗号分隔）']];

  const channelName = (type: string) => type === 'wecom' ? '企业微信' : type === 'dingtalk' ? '钉钉' : type === 'feishu' ? '飞书' : 'Web 聊天';
  const secretField = (key: string) => ['secret', 'token', 'aes_key', 'app_secret', 'robot_code'].includes(key);
  const embedCode = (channel: Channel) => {
    const siteKey = channel.config?.site_key ?? '';
    const src = `${WIDGET_BASE}/chat-widget.html?channelId=${encodeURIComponent(channel.id)}&siteKey=${encodeURIComponent(siteKey)}&apiBase=${encodeURIComponent(API_BASE)}`;
    return `<iframe src="${src}" title="AI 助手" loading="lazy" style="width:100%;height:480px;border:0;border-radius:12px"></iframe>`;
  };
  const dingTalkCallbackUrl = (channel: Channel) =>
    `${API_BASE}/callback/dingtalk/${encodeURIComponent(channel.id)}?token=${encodeURIComponent(channel.config?.callback_token ?? '')}`;

  return (
    <><PageData state={pageLoad} onRetry={load}>
      <div className="page-header">
        <div>
          <h1>渠道接入</h1>
          <div className="desc">统一管理对接平台：企业微信 / 钉钉 / 飞书 / Web 网页聊天</div>
        </div>
        <AsyncButton className="btn btn-primary" onClick={() => openEditor('wecom')}>+ 接入新渠道</AsyncButton>
      </div>

      {msg && <Feedback message={msg} />}

      {/* 渠道安全提示条（对齐原型） */}
      <div style={{ border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#92400e', marginBottom: 14 }}>
        🔐 <b>渠道安全基线</b>：转人工依赖 @机器人 触发（未@零消费）· 企微回调启用 <b>安全模式</b> 验签解密 · 测试连接会实际请求厂商鉴权接口
      </div>

      {/* 渠道卡片网格（对齐 04 原型） */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {channels.map((c) => (
          <div key={c.id} className="card">
            <div style={{ fontSize: 26, marginBottom: 10 }}>{CHANNEL_META[c.type]?.icon ?? '🔌'}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
              {c.name}
              <span className={`badge ${c.status === 'connected' ? 'badge-success' : 'badge-warning'}`} style={{ marginLeft: 8 }}>
                {c.status === 'connected' ? '已连接' : c.status === 'pending' ? '配置中' : '未连接'}
              </span>
            </div>
            <div className="small muted" style={{ marginBottom: 12 }}>{CHANNEL_META[c.type]?.desc}</div>
            <div className="small" style={{ marginBottom: 10 }}>
              绑定机器人：
              <select className="select" style={{ height: 28, fontSize: 12, marginLeft: 6 }} value={c.bindRobotId ?? ''} onChange={(e) => bind(c.id, e.target.value)}>
                <option value="">未绑定</option>
                {robots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="small muted" style={{ marginBottom: 8 }}>
              群 {groups.filter((g) => (g.channel ?? 'wecom') === c.type).length} 个 · 机器人 {c.bindRobotId ? 1 : 0} 个
            </div>
            <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
              <AsyncButton className="btn btn-secondary btn-sm" onClick={() => test(c.id)}>测试连接</AsyncButton>
              <AsyncButton className="btn btn-secondary btn-sm" onClick={() => openEditor(c.type, c)}>编辑配置</AsyncButton>
              {c.status !== 'connected' && <AsyncButton className="btn btn-primary btn-sm" onClick={() => connect(c.id)}>启用</AsyncButton>}
              {c.status === 'connected' && <AsyncButton className="btn btn-secondary btn-sm" onClick={() => disconnect(c.id, c.name)}>停用</AsyncButton>}
              {c.status === 'connected' && ['wecom', 'dingtalk', 'feishu'].includes(c.type) && (
                <AsyncButton className="btn btn-secondary btn-sm" disabled={syncingChannel === c.id} onClick={() => syncDirectory(c)}>
                  {syncingChannel === c.id ? '同步中…' : '同步通讯录'}
                </AsyncButton>
              )}
              <AsyncButton className="btn btn-secondary btn-sm" style={{ color: 'var(--error)' }} onClick={() => remove(c.id, c.name)}>删除</AsyncButton>
            </div>
            {c.type === 'wecom' && c.status === 'connected' && (
              <div style={{ marginTop: 10, border: '1px dashed var(--border)', borderRadius: 6, padding: 8, fontSize: 11, background: 'var(--bg-hover)' }}>
                <div style={{ color: 'var(--text-primary)', fontWeight: 500, marginBottom: 4 }}>回调配置（企微后台 → 接收消息）</div>
                <div className="muted">URL: <span className="mono">{API_BASE}/callback/wecom</span></div>
                <div className="muted">Token / AESKey: 见渠道配置（需公网可达）</div>
              </div>
            )}
            {c.type === 'dingtalk' && c.config?.connection_mode === 'http' && (
              <div style={{ marginTop: 10, border: '1px dashed var(--border)', borderRadius: 6, padding: 8, fontSize: 11, background: 'var(--bg-hover)' }}>
                <div style={{ color: 'var(--text-primary)', fontWeight: 500, marginBottom: 4 }}>回调配置（钉钉后台 → 消息接收地址）</div>
                <div className="mono" style={{ wordBreak: 'break-all', marginBottom: 6 }}>{dingTalkCallbackUrl(c)}</div>
                <AsyncButton className="btn btn-secondary btn-sm" disabled={!c.config?.callback_token} onClick={async () => {
                  await navigator.clipboard.writeText(dingTalkCallbackUrl(c));
                  setCopied(c.id); setTimeout(() => setCopied(null), 2000);
                }}>{copied === c.id ? '已复制 ✓' : '复制回调 URL'}</AsyncButton>
                <div className="muted" style={{ marginTop: 5 }}>钉钉服务器必须能访问该地址；生产环境请将前端的 VITE_API_BASE 配置为公网 HTTPS 后端地址，不能使用 localhost 或仅内网地址。</div>
              </div>
            )}
            {c.type === 'web' && c.status === 'connected' && (
              <div style={{ marginTop: 10, border: '1px dashed var(--border)', borderRadius: 6, padding: 8, fontSize: 11, background: 'var(--bg-hover)' }}>
                <div style={{ color: 'var(--text-primary)', fontWeight: 500, marginBottom: 4 }}>嵌入网页对话窗（复制到你的网站）</div>
                {c.bindRobotId ? (
                  <>
                    <div className="mono" style={{ wordBreak: 'break-all', marginBottom: 6 }}>
                      {c.config?.site_key ? embedCode(c) : '正在生成站点接入标识，请刷新页面后重试'}
                    </div>
                    <AsyncButton className="btn btn-secondary btn-sm" disabled={!c.config?.site_key} onClick={async () => {
                      await navigator.clipboard.writeText(embedCode(c));
                      setCopied(c.id); setTimeout(() => setCopied(null), 2000);
                    }}>{copied === c.id ? '已复制 ✓' : '复制代码'}</AsyncButton>
                  </>
                ) : (
                  <div className="muted">先绑定机器人（上方选择），生成嵌入代码</div>
                )}
              </div>
            )}
          </div>
        ))}
        {/* 未接入渠道占位卡 */}
        {(['wecom', 'dingtalk', 'feishu', 'web'] as const).filter((t) => !channels.some((c) => c.type === t)).map((t) => (
          <div key={t} className="card" style={{ opacity: 0.75 }}>
            <div style={{ fontSize: 26, marginBottom: 10 }}>{CHANNEL_META[t].icon}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
              {channelName(t)}
              <span className="badge badge-neutral" style={{ marginLeft: 8 }}>未接入</span>
            </div>
            <div className="small muted" style={{ marginBottom: 12 }}>{CHANNEL_META[t].desc}</div>
            <AsyncButton className="btn btn-secondary btn-sm" onClick={() => openEditor(t)}>接入渠道 →</AsyncButton>
          </div>
        ))}
        {/* 普通微信：不支持（channels.html 灰卡） */}
        <div className="card" style={{ opacity: 0.55 }}>
          <div style={{ fontSize: 26, marginBottom: 10 }}>💬</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
            普通微信
            <span className="badge badge-neutral" style={{ marginLeft: 8 }}>不支持</span>
          </div>
          <div className="small muted" style={{ marginBottom: 12 }}>个人微信无官方开放接口，存在封号与合规风险，平台不予接入</div>
        </div>
        {channels.length === 0 && <div className="card small muted">暂无已接入渠道，点击「接入新渠道」</div>}
      </div>

      {/* 接入弹窗：类型选择 + 配置 + 测试 + 启用 */}
      {showAdd && (
        <ModalFrame title={editing ? '编辑渠道' : '接入新渠道'} onClose={() => { setShowAdd(false); }}>
          <div className="card" style={{ width: 520, maxWidth: '94vw', maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="card-title">{editing ? `编辑 ${editing.name}` : '接入新渠道'}</div>
              <AsyncButton closeDialog style={{ cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)' }} onClick={() => { setShowAdd(false); setEditing(null); }}>✕</AsyncButton>
            </div>

            {!editing && <>
              <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>① 选择渠道类型</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                {Object.entries(CHANNEL_META).map(([t, m]) => (
                  <div role="button" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }} key={t} onClick={() => { setAddType(t); setConfig({}); }}
                    style={{ border: addType === t ? '2px solid var(--primary)' : '1px solid var(--border)', borderRadius: 8, padding: 10, cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ fontSize: 20 }}>{m.icon}</div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{channelName(t)}</div>
                    <div className="small muted">{m.desc}</div>
                  </div>
                ))}
              </div>
            </>}

            <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>{editing ? '渠道配置' : '② 渠道配置'}</div>
            {addType === 'dingtalk' && (
              <div style={{ marginBottom: 10 }}>
                <div className="small" style={{ marginBottom: 4 }}>消息接收模式</div>
                <select className="select" style={{ width: '100%' }} value={config.connection_mode ?? 'stream'}
                  onChange={(e) => setConfig({ ...config, connection_mode: e.target.value })}>
                  <option value="stream">Stream 长连接（无需公网回调）</option>
                  <option value="http">HTTP 回调（需要钉钉可达地址）</option>
                </select>
              </div>
            )}
            {fields(addType).map(([key, label]) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <div className="small" style={{ marginBottom: 4 }}>{label}</div>
                <input className="input" type={secretField(key) ? 'password' : 'text'} style={{ width: '100%' }} placeholder={addType === 'web' ? '例如：https://www.example.com' : label}
                  value={config[key] ?? ''} onChange={(e) => setConfig({ ...config, [key]: e.target.value })} />
              </div>
            ))}

            {addType === 'dingtalk' && (
              <div className="small" style={{ border: '1px solid var(--border-light)', borderRadius: 8, padding: 10, marginBottom: 12, lineHeight: 1.7 }}>
                {config.connection_mode === 'http' ? (
                  <><b>钉钉 Web/HTTP 接入：</b>先保存配置，再将渠道卡片上生成的回调 URL 填入钉钉后台的“消息接收地址”。部署到公网时将 VITE_API_BASE 指向公网 HTTPS 后端；本地 localhost 地址仅适合本机联调，钉钉服务器无法访问。</>
                ) : (
                  <><b>钉钉 Stream 接入：</b>创建企业内部应用 → 添加“机器人”能力并选择 Stream 模式 → 发布应用。无需配置公网回调地址。</>
                )}填写 Client ID（AppKey）、Client Secret 和机器人 Code。启用后，把机器人加入群并 @ 一次，群会自动进入“群管理”等待绑定。
              </div>
            )}
            {addType === 'web' && (
              <div className="small" style={{ border: '1px solid var(--border-light)', borderRadius: 8, padding: 10, marginBottom: 12, lineHeight: 1.7 }}>
                <b>Web 接入：</b>填写允许嵌入的完整站点来源（多个用逗号分隔），保存后测试、绑定已发布机器人并启用，即可复制可跨站使用的 iframe 代码。
              </div>
            )}

            <div className="small muted" style={{ marginBottom: 16 }}>配置完成后测试连接，通过后启用；生产环境请使用专用应用凭据并定期轮换。</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <AsyncButton closeDialog className="btn btn-secondary" onClick={() => { setShowAdd(false); setEditing(null); }}>取消</AsyncButton>
              <AsyncButton className="btn btn-primary" onClick={saveChannel}>{editing ? '保存配置' : '接入渠道'}</AsyncButton>
            </div>
          </div>
        </ModalFrame>
      )}
    </PageData></>
  );
}
