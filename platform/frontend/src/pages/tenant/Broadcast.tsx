import { useFeedback, Feedback, AsyncButton, ModalFrame } from '../../components/Interaction';
import { useEffect, useRef, useState } from 'react';
import { api, CURRENT_TENANT_ID } from '../../api/client';
import type { Group, Robot } from '../../api/types';
import { fmtMDHM } from '../../api/datetime';

const TID = CURRENT_TENANT_ID;

interface SendResp { record: RecordRow; attempts: Record<string, number>; failedGroups?: string[] }
interface RecordRow { id: string; content: string; images?: string[]; robotIds?: string[]; groupIds?: string[]; operator?: string; status: string; results: Record<string, string>; pollIntervalMinutes?: number; pollCount?: number; completedPolls?: number; nextPollAt?: string; createdAt: string; groupChannels?: Map<string, string> | Record<string, string> }

const CHANNEL_ICON: Record<string, string> = { wecom: '💼', dingtalk: '🔷', feishu: '🪶', web: '🌐' };
const channelOf = (r: RecordRow, chatId: string) => {
  const m = r.groupChannels as Record<string, string> | undefined;
  const ch = m ? m[chatId] : undefined;
  return ch ? `${CHANNEL_ICON[ch] ?? ''}${ch}` : '';
};

export default function Broadcast() {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [msg, setMsg] = useFeedback();

  // 弹窗状态
  const [showModal, setShowModal] = useState(false);
  const [selRobots, setSelRobots] = useState<string[]>([]);
  const [selGroups, setSelGroups] = useState<string[]>([]);
  const [content, setContent] = useState('');
  const [images, setImages] = useState<string[]>([]); // base64 图片列表
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState(5);
  const [pollCount, setPollCount] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<Robot[]>(`/api/v1/tenant/robots?tenantId=${TID}`).then(setRobots).catch(() => {});
    refreshRecords();
  }, []);

  const hasActivePlan = records.some((record) => ['PENDING', 'SENDING', 'SCHEDULED'].includes(record.status));
  useEffect(() => {
    if (!hasActivePlan) return;
    const timer = window.setInterval(() => refreshRecords().catch(() => {}), 15_000);
    return () => window.clearInterval(timer);
  }, [hasActivePlan]);

  async function refreshRecords() {
    setRecords(await api<RecordRow[]>(`/api/v1/tenant/broadcast?tenantId=${TID}`));
  }

  async function loadGroups(robotIds: string[]) {
    if (!robotIds.length) { setGroups([]); setSelGroups([]); return; }
    const g = await api<Group[]>(`/api/v1/tenant/broadcast/groups?tenantId=${TID}&robotIds=${robotIds.join(',')}`);
    setGroups(g); setSelGroups([]);
  }

  function toggleRobot(id: string) {
    const next = selRobots.includes(id) ? selRobots.filter((r) => r !== id) : [...selRobots, id];
    setSelRobots(next);
    loadGroups(next);
  }

  // 插入图片（本地文件 → base64 预览）
  function insertImages(files: FileList | null) {
    if (!files) return;
    Array.from(files).slice(0, 3).forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => setImages((prev) => [...prev, String(reader.result)]);
      reader.readAsDataURL(f);
    });
  }

  async function send() {
    if (!content.trim() && !images.length) { setMsg('❌ 请输入内容或插入图片'); return; }
    if (!selGroups.length) { setMsg('❌ 至少选一个群'); return; }
    if (!Number.isInteger(pollCount) || pollCount < 1 || pollCount > 100) { setMsg('❌ 轮询次数须为 1-100 的整数'); return; }
    if (pollCount > 1 && (!Number.isInteger(pollIntervalMinutes) || pollIntervalMinutes < 1 || pollIntervalMinutes > 1440)) { setMsg('❌ 轮询间隔须为 1-1440 分钟的整数'); return; }
    try {
      const r = await api<SendResp>('/api/v1/tenant/broadcast', {
        method: 'POST',
        body: JSON.stringify({ tenantId: TID, robotIds: selRobots, groupIds: selGroups, content, images, operator: 'admin', pollIntervalMinutes: pollCount > 1 ? pollIntervalMinutes : 5, pollCount }),
      });
      const resultText = Object.entries(r.record.results ?? {}).map(([k, v]) => `${k.slice(0, 10)}=${v}`).join(', ');
      setMsg(pollCount > 1
        ? `✅ 首轮发送完成，已创建 ${pollCount} 轮计划（每 ${pollIntervalMinutes} 分钟执行）：${resultText}`
        : `✅ 发送完成（${r.record.status}）：${resultText}${r.failedGroups?.length ? ` · ⚠️ ${r.failedGroups.length} 群失败已提醒人工介入` : ''}`);
      if (pollCount === 1 && r.failedGroups?.length) { setSelGroups(r.failedGroups); setMsg(`成功 ${selGroups.length - r.failedGroups.length} 群，失败 ${r.failedGroups.length} 群。失败群已保留，可重试。${resultText}`); await refreshRecords(); return; }
      setShowModal(false);
      setContent(''); setImages([]); setSelRobots([]); setSelGroups([]);
      setPollIntervalMinutes(5); setPollCount(1);
      refreshRecords();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>消息发送</h1>
          <div className="desc">选择群并编辑内容后发送，可配置轮询间隔与执行次数 · 单群失败自动重试 3 次</div>
        </div>
        <AsyncButton className="btn btn-primary" onClick={() => setShowModal(true)}>📨 发送消息</AsyncButton>
      </div>

      {msg && <Feedback message={msg} />}

      {/* 发送记录 */}
      <div className="card">
        <div className="card-title" style={{ marginBottom: 12 }}>发送记录（计划在服务重启后自动恢复）</div>
        <div className="table-wrap"><div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
          <thead><tr><th>时间</th><th>操作人</th><th>机器人</th><th>目标群</th><th>内容</th><th>轮询计划</th><th>状态</th><th>逐群结果</th><th>操作</th></tr></thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} style={r.status === 'FAILED' || r.status === 'PARTIAL' ? { background: 'var(--error-bg)' } : {}}>
                <td className="muted small">{fmtMDHM(r.createdAt)}</td>
                <td className="muted small">{r.operator ?? '—'}</td>
                <td className="muted small">{(r.robotIds ?? []).map((id) => robots.find((rb) => rb.id === id)?.name ?? id.slice(0, 6)).join('、') || '—'}</td>
                <td className="muted small">{(r.groupIds ?? []).length} 群</td>
                <td className="muted small" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.content}{r.images?.length ? ` [${r.images.length} 图]` : ''}
                </td>
                <td className="muted small">
                  {r.pollCount && r.pollCount > 1 ? (
                    <>{r.completedPolls ?? 0}/{r.pollCount} 轮 · 每 {r.pollIntervalMinutes} 分钟{r.nextPollAt ? <><br />下次 {fmtMDHM(r.nextPollAt)}</> : null}</>
                  ) : '单次'}
                </td>
                <td>
                  {(() => {
                    const vals = Object.values(r.results ?? {});
                    const ok = vals.filter((v) => v !== 'error').length;
                    if (r.status === 'SCHEDULED') return <span className="badge badge-info">等待下一轮</span>;
                    if (r.status === 'SENDING' || r.status === 'PENDING') return <span className="badge badge-warning">发送中</span>;
                    return (
                      <span className={`badge ${r.status === 'SUCCESS' ? 'badge-success' : r.status === 'PARTIAL' ? 'badge-warning' : 'badge-error'}`}>
                        {r.status === 'SUCCESS' ? `成功 ${ok}/${vals.length}` : r.status === 'PARTIAL' ? `部分成功 ${ok}/${vals.length}` : `失败 ${vals.length - ok}/${vals.length}`}
                      </span>
                    );
                  })()}
                </td>
                <td className="small muted">{Object.entries(r.results ?? {}).map(([k, v]) => `${k.slice(0, 8)}(${channelOf(r, k)}):${v}`).join(' · ') || '—'}</td>
                <td>
                  {!['PENDING', 'SENDING', 'SCHEDULED'].includes(r.status) && Object.values(r.results ?? {}).some((v) => v === 'error') && (
                    <AsyncButton className="link" onClick={async () => { await api(`/api/v1/tenant/broadcast/${r.id}/retry`, { method: 'POST' }); refreshRecords(); }}>重试失败群</AsyncButton>
                  )}
                </td>
              </tr>
            ))}
            {records.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 24 }}>暂无发送记录</td></tr>}
          </tbody>
        </table></div></div>
      </div>

      {/* 发送消息弹窗 */}
      {showModal && (
        <ModalFrame title="新建消息" onClose={() => { setShowModal(false); }}>
          <div className="card" style={{ width: 640, maxWidth: '94vw', maxHeight: '88vh', overflowY: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="card-title">新建消息</div>
              <AsyncButton closeDialog style={{ cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)' }} onClick={() => setShowModal(false)}>✕</AsyncButton>
            </div>

            {/* ① 选择机器人 */}
            <div className="card-title" style={{ fontSize: 14, marginBottom: 8 }}>① 选择机器人（多选）</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              {robots.map((r) => (
                <label key={r.id} className="flex gap-3" style={{ gap: 8, padding: '6px 0', fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={selRobots.includes(r.id)} onChange={() => toggleRobot(r.id)} style={{ accentColor: 'var(--primary)' }} />
                  {r.name}
                </label>
              ))}
            </div>

            {/* ② 选择群 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div className="card-title" style={{ fontSize: 14 }}>② 选择群（已选 {selGroups.length}/{groups.length}）</div>
              <div className="small">
                <AsyncButton className="link" onClick={() => setSelGroups(groups.map((g) => g.chatId))}>全选</AsyncButton>
                <span className="muted"> / </span>
                <AsyncButton className="link" onClick={() => setSelGroups([])}>清空</AsyncButton>
              </div>
            </div>
            <div style={{ border: '1px solid var(--border-light)', borderRadius: 8, padding: 10, maxHeight: 140, overflowY: 'auto', marginBottom: 16 }}>
              {groups.map((g) => (
                <label key={g.id} className="flex gap-3" style={{ gap: 8, padding: '6px 0', fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={selGroups.includes(g.chatId)}
                    onChange={() => setSelGroups(selGroups.includes(g.chatId) ? selGroups.filter((x) => x !== g.chatId) : [...selGroups, g.chatId])}
                    style={{ accentColor: 'var(--primary)' }} />
                  {g.name ?? g.chatId}
                  <span className="small muted">绑定机器人：{robots.find((r) => r.id === g.robotId)?.name ?? '—'}{g.channel ? ` · ${CHANNEL_ICON[g.channel] ?? ''}${g.channel}` : ''}</span>
                </label>
              ))}
              {!selRobots.length && <div className="small muted" style={{ padding: 8 }}>先选择机器人，展示其绑定群</div>}
            </div>

            {/* ③ 消息内容（支持图片 + 实时预览，对齐原型 preview-box） */}
            <div className="card-title" style={{ fontSize: 14, marginBottom: 8 }}>③ 消息内容</div>
            <textarea className="input" rows={5} value={content} onChange={(e) => setContent(e.target.value)}
              placeholder="输入消息内容…" style={{ width: '100%', padding: 12, fontFamily: 'inherit', marginBottom: 10 }} />
            <div style={{ border: '1px dashed var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 10, background: 'var(--bg-hover)' }}>
              <div className="small muted" style={{ marginBottom: 4 }}>实时预览（{content.length} 字{images.length ? ` · ${images.length} 图` : ''}）</div>
              <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>
                {content || <span className="muted">内容为空…</span>}
                {images.length > 0 && <span style={{ marginLeft: 6 }}>{' '.repeat(0)}[🖼️ {images.length} 张图片]</span>}
              </div>
            </div>

            {/* 图片插入 */}
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => insertImages(e.target.files)} />
            <AsyncButton className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>🖼️ 插入图片</AsyncButton>
            {images.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {images.map((img, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={img} alt={`图片${i + 1}`} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                    <AsyncButton closeDialog style={{ position: 'absolute', top: -6, right: -6, background: 'var(--error)', color: '#fff', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, cursor: 'pointer' }}
                      onClick={() => setImages(images.filter((_, x) => x !== i))}>✕</AsyncButton>
                  </div>
                ))}
              </div>
            )}

            {/* ④ 轮询计划：首轮立即执行，次数包含首轮 */}
            <div className="card-title" style={{ fontSize: 14, marginTop: 18, marginBottom: 8 }}>④ 轮询设置</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="small">
                <span style={{ display: 'block', marginBottom: 5 }}>轮询间隔（分钟）</span>
                <input className="input" type="number" min={1} max={1440} step={1} disabled={pollCount === 1} value={pollIntervalMinutes}
                  onChange={(e) => setPollIntervalMinutes(Number(e.target.value))} style={{ width: '100%' }} />
              </label>
              <label className="small">
                <span style={{ display: 'block', marginBottom: 5 }}>轮询次数（含首轮）</span>
                <input className="input" type="number" min={1} max={100} step={1} value={pollCount}
                  onChange={(e) => setPollCount(Number(e.target.value))} style={{ width: '100%' }} />
              </label>
            </div>
            <div className="small muted" style={{ marginTop: 7 }}>
              第 1 轮会立即发送{pollCount > 1 ? `，之后每 ${pollIntervalMinutes || '—'} 分钟执行一次，共 ${pollCount || '—'} 轮` : '；当前为单次发送'}。
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <AsyncButton closeDialog className="btn btn-secondary" onClick={() => setShowModal(false)}>取消</AsyncButton>
              <AsyncButton className="btn btn-primary" onClick={send}>{pollCount > 1 ? '发送并创建计划' : '发 送'}</AsyncButton>
            </div>
          </div>
        </ModalFrame>
      )}
    </>
  );
}
