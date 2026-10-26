import { AsyncButton } from '../../components/Interaction';
import { useEffect, useState } from 'react';
import { api, CURRENT_TENANT_ID } from '../../api/client';

const TID = CURRENT_TENANT_ID;

/** 消息测试（AI Router 主链路入口）：模拟用户 @机器人 → 身份→权限→检索→回答 */
export default function Messages() {
  const [conversationId, setConversationId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [content, setContent] = useState('账号被冻结怎么办');
  const [userId, setUserId] = useState('player_test_1');
  const [chatId, setChatId] = useState('');
  const [channel, setChannel] = useState('wecom');
  const [robotId, setRobotId] = useState('');
  const [robots, setRobots] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [at, setAt] = useState(true);
  const [result, setResult] = useState<string>('');

  useEffect(() => {
    api<Array<{ id: string; name: string; status: string }>>(`/api/v1/tenant/robots?tenantId=${TID}`).then((d) => {
      setRobots(d);
      if (d.length) setRobotId(d[0].id);
    }).catch(e => setResult('机器人列表读取失败：' + e.message));
  }, []);

  async function send() {
    setBusy(true);
    try {
      const r = await api<{ conversationId?: string; processed: boolean; answer: string; hits: number; roles: string[] }>('/api/v1/tenant/messages', {
        method: 'POST',
        body: JSON.stringify({ tenantId: TID, channel, channelUserId: userId, chatId, robotId: chatId ? undefined : robotId, isAtRobot: at, content, conversationId }),
      });
      setConversationId(r.conversationId);
      setResult(
        `✅ processed=${r.processed} · 角色=[${r.roles?.join(',')}] · 命中=${r.hits}\n\n回答：${r.answer}`,
      );
    } catch (e) {
      setResult('❌ ' + (e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>消息测试（AI Router）</h1>
          <div className="desc">模拟用户消息 → @触发 → 身份识别 → 权限计算 → ds-key 检索 → 回答</div>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 720 }}>
        <label style={{ display: 'block', marginBottom: 12 }}>测试渠道
          <select className="select" value={channel} disabled={busy} onChange={e => { setChannel(e.target.value); setConversationId(undefined); setResult(''); }}>
            <option value="wecom">企业微信</option><option value="dingtalk">钉钉</option><option value="feishu">飞书</option><option value="web">Web</option>
          </select>
        </label>
        <p className="small muted">使用对应渠道身份验证权限和回答，只在此页面展示结果，不向外部群聊发送消息。</p>
        <div className="flex gap-3" style={{ marginBottom: 12 }}>
          <input className="input" style={{ flex: 1 }} placeholder="消息内容" value={content} onChange={(e) => setContent(e.target.value)} />
        </div>
        <div className="flex gap-3" style={{ marginBottom: 12 }}>
          <input className="input" placeholder="渠道用户 ID" value={userId} disabled={busy} onChange={(e) => { setUserId(e.target.value); setConversationId(undefined); setResult(''); }} />
          <input className="input" placeholder="chat_id（留空=独立单聊）" value={chatId} disabled={busy} onChange={(e) => { setChatId(e.target.value); setConversationId(undefined); setResult(''); }} />
          <select className="select" disabled={busy || !!chatId} value={robotId} onChange={(e) => { setRobotId(e.target.value); setConversationId(undefined); }} title="独立单聊目标机器人">
            {robots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="flex gap-3" style={{ marginBottom: 16 }}>
          <label className="flex gap-3" style={{ gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={at} onChange={(e) => setAt(e.target.checked)} /> @机器人（未@零消费）
          </label>
          <AsyncButton className="btn btn-primary" disabled={busy || !content.trim() || !userId.trim() || (!chatId && !robotId)} onClick={send}>{busy ? "回答中…" : "发送消息"}</AsyncButton><AsyncButton className="btn btn-secondary" disabled={busy} onClick={() => { setConversationId(undefined); setResult(""); }}>新会话</AsyncButton>
        </div>
        {result && (
          <pre style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{result}</pre>
        )}
        <div className="small muted mt-4">💡 群消息：填 chat_id + 勾选@机器人；独立单聊：chat_id 留空 + 选择机器人直接访问</div>
      </div>
    </>
  );
}
