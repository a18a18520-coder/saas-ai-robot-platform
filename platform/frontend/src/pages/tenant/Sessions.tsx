import { Modal, LoadState, PageData, AsyncButton } from '../../components/Interaction';
import { useEffect, useRef, useState } from 'react';
import { api, CURRENT_TENANT_ID } from '../../api/client';
import type { Group } from '../../api/types';
import { fmtMDHM } from '../../api/datetime';

const TID = CURRENT_TENANT_ID;

interface SessionRow { id: string; robotId?: string; groupId?: string; userId: string; messageCount: number; updatedAt: string }
interface MsgRow { role: string; content: string; createdAt: string }

const fmt = (iso: string) => fmtMDHM(iso || '');
const ROLE_META: Record<string, { label: string; icon: string; style: Record<string, string> }> = {
  user: { label: '用户', icon: '👤', style: {} },
  assistant: { label: 'AI', icon: '🤖', style: {} },
  human: { label: '人工接管', icon: '🙋', style: { border: '1px solid #f59e0b', background: '#fffbeb' } },
  system: { label: '系统', icon: '⚙', style: {} },
};

export default function Sessions() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const listRequest = useRef(0);
  const [users, setUsers] = useState<Array<{ id: string; name?: string; identity: string }>>([]);
  const [active, setActive] = useState<string>('');
  const messageRequest = useRef(0);
  const [messagesLoading, setMessagesLoading] = useState(false), [messagesError, setMessagesError] = useState('');
  const [messages, setMessages] = useState<MsgRow[]>([]);
  const [keyword, setKeyword] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [robots, setRobots] = useState<Array<{ id: string; name: string }>>([]);

  const [pageLoad, setPageLoad] = useState({ loading: true, ready: false, error: '' });
  async function load() {
    const request = ++listRequest.current;
    setPageLoad(old => ({ ...old, loading: true, error: '' }));
    try {
    const [sessionRows, userRows, groupRows, robotRows] = await Promise.all([
      api<{ items: SessionRow[]; total: number }>(`/api/v1/tenant/sessions?tenantId=${TID}&page=${page}&pageSize=50`),
      api<Array<{ id: string; name?: string; identity: string }>>(`/api/v1/tenant/users?tenantId=${TID}&status=ALL`),
      api<Group[]>(`/api/v1/tenant/groups?tenantId=${TID}`),
      api<Array<{ id: string; name: string }>>(`/api/v1/tenant/robots?tenantId=${TID}`),
    ]);
    if (request !== listRequest.current) return;
    setSessions(sessionRows.items); setTotal(sessionRows.total);
    setUsers(userRows);
    setGroups(groupRows);
    setRobots(robotRows);

      setPageLoad({ loading: false, ready: true, error: '' });
    } catch (cause) { if (request === listRequest.current) setPageLoad(old => ({ ...old, loading: false, error: (cause as Error).message })); }
  }

  useEffect(() => {
    load().catch(() => {});
    const timer = window.setInterval(() => load().catch(() => {}), 15000);
    return () => { listRequest.current++; window.clearInterval(timer); };
  }, [page]);

  const userMeta = (uid: string) => users.find((u) => u.id === uid);
  const groupOf = (gid?: string) => (gid ? groups.find((g) => g.id === gid || g.chatId === gid) : undefined);
  const robotLabel = (s: SessionRow) => {
    const rid = s.robotId || groupOf(s.groupId)?.robotId;
    return rid ? (robots.find((r) => r.id === rid)?.name ?? '机器人') : '未绑定机器人';
  };
  const groupLabel = (s: SessionRow) => (s.groupId ? (groupOf(s.groupId)?.name ?? `群 ${s.groupId.slice(0, 14)}`) : '单聊');
  const filtered = sessions.filter((s) =>
    !keyword || (s.groupId ?? '').includes(keyword) || groupLabel(s).includes(keyword) || (userMeta(s.userId)?.name ?? '').includes(keyword));

  async function open(id: string) {
    const request = ++messageRequest.current; setActive(id); setMessages([]); setMessagesLoading(true); setMessagesError('');
    try { const rows = await api<MsgRow[]>(`/api/v1/tenant/sessions/${id}/messages`); if (request === messageRequest.current) setMessages(rows); }
    catch (cause) { if (request === messageRequest.current) setMessagesError((cause as Error).message); }
    finally { if (request === messageRequest.current) setMessagesLoading(false); }
  }

  return (
    <><PageData state={pageLoad} onRetry={load}>
      <div className="page-header">
        <div>
          <h1>会话管理</h1>
          <div className="desc">五层会话模型 · 群内按用户隔离 · 手机号合并后会话归并（BR-009）</div>
        </div>
        <div className="flex gap-3">
          <input className="input" style={{ width: 200 }} placeholder="筛选当前页用户/群…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <AsyncButton className="btn btn-secondary" onClick={() => load()}>刷新会话</AsyncButton>
        </div>
      </div>
      <div>
        <div className="card" style={{ padding: 14 }}>
          <div className="card-sub" style={{ marginBottom: 10 }}>共 {total} 条会话 · 当前页显示 {filtered.length} / {sessions.length} 条</div>
          <div className="flex gap-3" style={{ marginBottom: 12 }}>
            <button className="btn btn-secondary btn-sm" disabled={page <= 1 || pageLoad.loading} onClick={() => setPage(p => p - 1)}>上一页</button>
            <span aria-live="polite">第 {page} / {Math.max(1, Math.ceil(total / 50))} 页</span>
            <button className="btn btn-secondary btn-sm" disabled={page * 50 >= total || pageLoad.loading} onClick={() => setPage(p => p + 1)}>下一页</button>
          </div>
          {filtered.map((s) => {
            const u = userMeta(s.userId);
            return (
              <AsyncButton className="session-row" key={s.id} onClick={() => open(s.id)}
                style={{ padding: '10px 12px', border: '1px solid var(--border-light)', borderRadius: 8, marginBottom: 6, cursor: 'pointer', fontSize: 13, ...(active === s.id ? { borderColor: 'var(--primary)', background: 'var(--primary-light)' } : {}) }}>
                <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                  {u?.name ?? '未命名'} <span className="small muted">（{u?.identity ?? '游客'}）</span>
                </div>
                <div className="small muted">
                  {robotLabel(s)} · {groupLabel(s)} · {s.messageCount} 条 · {fmt(s.updatedAt)}
                </div>
              </AsyncButton>
            );
          })}
          {filtered.length === 0 && <div className="small muted" style={{ padding: 16, textAlign: 'center' }}>暂无会话</div>}
        </div>
        {active && <Modal title="会话详情" drawer dirty={false} onClose={() => { messageRequest.current++; setActive(''); }}><LoadState loading={messagesLoading} error={messagesError} onRetry={() => open(active)}><div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div className="card-title">
                会话详情{active ? ` — ${userMeta(sessions.find((s) => s.id === active)?.userId ?? '')?.name ?? '未命名'}（${userMeta(sessions.find((s) => s.id === active)?.userId ?? '')?.identity ?? '游客'}）` : ''}
              </div>
              {active && sessions.find((s) => s.id === active) && (
                <div className="card-sub">
                  {robotLabel(sessions.find((s) => s.id === active)!)} · {groupLabel(sessions.find((s) => s.id === active)!)} · {sessions.find((s) => s.id === active)!.messageCount} 条消息
                </div>
              )}
            </div>
            {active && <a className="link" href="/t/audit">查看审计 →</a>}
          </div>
          {messages.length === 0 && <div className="small muted">该会话暂无消息</div>}
          {messages.map((m, i) => {
            const meta = ROLE_META[m.role] ?? ROLE_META.system;
            return (
              <div key={i} style={{ marginBottom: 10, maxWidth: '82%', marginLeft: m.role === 'user' || m.role === 'human' ? 0 : 'auto' }}>
                <div className="small muted" style={{ marginBottom: 2, display: 'flex', gap: 8 }}>
                  <span>{meta.icon} {meta.label}</span>
                  {m.createdAt && <span>{fmt(m.createdAt)}</span>}
                </div>
                <div style={{
                  background: m.role === 'assistant' ? 'var(--bg-secondary)' : m.role === 'human' ? '#fffbeb' : 'var(--primary-light)',
                  color: 'var(--text-primary)',
                  padding: '10px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                  ...meta.style,
                }}>{m.content}</div>
              </div>
            );
          })}
        </div></LoadState></Modal>}
      </div>
    </PageData></>
  );
}
