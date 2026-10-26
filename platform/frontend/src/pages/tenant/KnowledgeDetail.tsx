import { useFeedback, Feedback, Tabs, confirmAction, AsyncButton, ModalFrame } from '../../components/Interaction';
import RecordId from '../../components/RecordId';
import { readableFilename } from '../../utils/filename';
import PipelineSettings from './PipelineSettings';
import Wiki from './Wiki';
import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, CURRENT_TENANT_ID, downloadApi } from '../../api/client';

const TID = CURRENT_TENANT_ID;


interface FileRow { id: string; name: string; secLevel: number; indexing_status: string; size?: number; segmentTotal?: number | null }
interface Segment { content: string; position?: number; word_count?: number; child_chunks?: Array<{ id: string; content: string }> }
interface SegmentsResp { list: Segment[]; total: number; page: number; limit: number }

const fmtSize = (b?: number) => {
  if (!b) return '—';
  if (b > 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return Math.max(1, Math.round(b / 1024)) + ' KB';
};
const STATUS_META: Record<string, { label: string; cls: string }> = {
  completed: { label: '✅ 已同步', cls: 'badge-success' },
  indexing: { label: '⏳ 索引中', cls: 'badge-warning' },
  queued: { label: '⏳ 排队中', cls: 'badge-warning' },
  paused: { label: '⏸ 已暂停', cls: 'badge-neutral' },
  error: { label: '❌ 失败', cls: 'badge-error' },
};

const SEC: Record<number, { label: string; cls: string }> = {
  1: { label: '🔓 普通', cls: 'badge-neutral' },
  2: { label: '🔐 内部', cls: 'badge-info' },
  3: { label: '🔒 机密', cls: 'badge-error' },
};

// 例外：保留既有深链接，支持收藏和直接访问；列表入口使用抽屉。
export default function KnowledgeDetail({ datasetId, onClose }: { datasetId?: string; onClose?: () => void } = {}) {
  const params = useParams();
  const id = datasetId ?? params.id ?? '';
  const [wikiPageId, setWikiPageId] = useState('');
  const [importing, setImporting] = useState('');
  async function createWiki(documentId: string) {
    setImporting(documentId); setMsg('正在读取完整正文并创建 Wiki 草稿…');
    try {
      const result = await api<{ page: { id: string }; reused: boolean }>('/api/v1/tenant/wiki/import-document', { method: 'POST', body: JSON.stringify({ datasetId: id, documentId }) });
      setMsg(''); setWikiPageId(result.page.id);
    } catch (e) { setMsg((e as Error).message); } finally { setImporting(''); }
  }
  const [kbName, setKbName] = useState('知识库详情');
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [secLevel, setSecLevel] = useState<number>(1);
  const [msg, setMsg] = useFeedback();
  const [showUpload, setShowUpload] = useState(false);
  // 预览
  const [preview, setPreview] = useState<{ name: string; documentId: string; segments: Segment[]; total: number; page: number; limit: number } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  // 更新
  const [updatingId, setUpdatingId] = useState('');
  const updateRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  // 套餐知识库总容量
  const [storageLimitMb, setStorageLimitMb] = useState(0);
  // 上传弹窗：多文件暂存 + 确认上传 + 密级策略勾选
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [calcSec, setCalcSec] = useState(true);
  const [auditUpload, setAuditUpload] = useState(true);

  async function load() {
    setLoadingFiles(true);
    try { const rows = await api<FileRow[]>(`/api/v1/tenant/knowledge/${id}/documents?tenantId=${TID}`); setFiles(rows.map(row => ({ ...row, name: readableFilename(row.name) }))); }
    finally { setLoadingFiles(false); }
    api<{ plan?: { storageLimitMb?: number } }>(`/api/v1/tenant/profile?tenantId=${TID}`)
      .then((d) => setStorageLimitMb(d.plan?.storageLimitMb ?? 0)).catch(() => {});
  }
  useEffect(() => { load().catch(e => setMsg(`文件列表读取失败：${e.message}`)); api<Array<{datasetId: string; name: string}>>('/api/v1/tenant/knowledge-base').then(rows => setKbName(rows.find(row => row.datasetId === id)?.name ?? '知识库详情')).catch(e => setMsg(e.message)); }, [id]);

  const totalBytes = files.reduce((a, f) => a + (f.size ?? 0), 0);
  const storagePct = storageLimitMb > 0 ? Math.min(100, Math.round((totalBytes / 1024 / 1024 / storageLimitMb) * 100)) : 0;

  async function upload(file: File, opts?: { calcSec?: boolean; auditLog?: boolean }) {
    if (file.size > 15 * 1024 * 1024) { setMsg(`「${file.name}」超过单文件 15 MB 限制，请拆分文件后上传。`); return false; }
    const form = new FormData();
    form.append('file', file);
    try {
      await api(`/api/v1/tenant/knowledge/${id}/documents?tenantId=${TID}&secLevel=${secLevel}${opts?.calcSec ? '&calcSec=true' : ''}${opts?.auditLog ? '&auditLog=true' : ''}`, { method: 'POST', body: form });
      setMsg(`✅ 「${file.name}」已上传，等待切片完成`); return true;
    } catch (e) { setMsg('❌ ' + (e as Error).message); return false; }
  }

  /** 确认上传（批量逐个上传所选文件） */
  async function confirmUpload() {
    setUploading(true);
    const failed: File[] = [];
    for (const f of pendingFiles) if (!await upload(f, { calcSec, auditLog: auditUpload })) failed.push(f);
    setUploading(false); setPendingFiles(failed);
    if (!failed.length) setShowUpload(false);
    else setMsg(`${failed.length} 个文件上传失败，已保留，可重试。`);
    load().catch(e => setMsg(e.message));
  }

  async function previewDoc(documentId: string, name: string, page = 1) {
    setPreviewBusy(true);
    try {
      const r = await api<SegmentsResp>(`/api/v1/tenant/knowledge/${id}/documents/${documentId}/segments?page=${page}&limit=20`);
      setPreview({ name, documentId, segments: r.list, total: r.total, page: r.page, limit: r.limit });
    } catch (e) { setMsg('❌ ' + (e as Error).message); } finally { setPreviewBusy(false); }
  }

  async function updateDoc(documentId: string, file: File) {
    if (file.size > 15 * 1024 * 1024) { setMsg('单文件不能超过 15 MB，请拆分后上传。'); return; }
    const form = new FormData();
    form.append('file', file);
    try {
      const r = await api<{ replaced: boolean; secLevel: number }>(`/api/v1/tenant/knowledge/${id}/documents/${documentId}?tenantId=${TID}`, { method: 'PUT', body: form });
      setMsg(`✅ 「${file.name}」已更新（替换，密级保留 ${['', '普通', '内部', '机密'][r.secLevel]}）`); setUpdatingId(''); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  async function remove(documentId: string) {
    if (!(await confirmAction('确认删除该文件？将同步删除 Dify 中对应内容', { confirmText: '确认删除' }))) return;
    try { await api(`/api/v1/tenant/knowledge/${id}/documents/${documentId}?tenantId=${TID}`, { method: 'DELETE' }); setMsg('✅ 已删除'); load(); }
    catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  return (
    <>
      <div className="page-header">
        <div>
          {!onClose && <Link to="/t/knowledge" className="link small">← 返回知识库列表</Link>}
          <h1 style={{ marginTop: 4 }}>📚 {kbName}</h1>
          <div className="desc">上传（含密级）· 预览内容 · 更新替换 · 下载（FR-009）</div>
        </div>
        <AsyncButton className="btn btn-primary" onClick={() => setShowUpload(true)}>+ 上传文件</AsyncButton>
      </div>

      {msg && <Feedback message={msg} />}

      <Tabs param="knowledgeTab" items={[{ id: 'files', label: '知识文件', content: <>
      {/* 指标卡（对齐原型 knowledge-detail.html：文件数/切片总数/文件密级/可见范围 + 总容量） */}
      <div className="metrics">
        <div className="metric"><div className="m-label">文件数</div><div className="m-value">{files.length}</div><div className="m-sub">{files.filter((f) => f.indexing_status === 'completed').length} 已同步</div></div>
        <div className="metric"><div className="m-label">切片总数</div><div className="m-value">{files.reduce((a, f) => a + (f.segmentTotal ?? 0), 0) || '—'}</div><div className="m-sub">可检索内容</div></div>
        <div className="metric"><div className="m-label">总容量</div><div className="m-value" style={{ fontSize: 18 }}>{fmtSize(totalBytes) || '—'}</div>
          <div className="m-sub">{storageLimitMb > 0 ? `套餐 ${storageLimitMb}MB · ${storagePct}%` : '套餐不限容量'}</div>
        </div>
        <div className="metric"><div className="m-label">文件密级</div><div className="m-value" style={{ fontSize: 18 }}>{Math.max(1, ...files.map((f) => f.secLevel)) >= 3 ? '🔒 机密' : Math.max(1, ...files.map((f) => f.secLevel)) === 2 ? '🔐 内部' : '🔓 普通'}</div><div className="m-sub">最高密级</div></div>
        <div className="metric"><div className="m-label">可见范围</div><div className="m-value" style={{ fontSize: 14 }}>角色∩部门∩密级</div><div className="m-sub">动态知识权限</div></div>
      </div>

      {/* 文件列表 */}
      <div className="card">
        {loadingFiles ? <div role="status" style={{ padding: 24 }}>正在读取文件和切片统计，请稍候…</div> : files.length === 0 ? (
          <div style={{ border: '1px dashed var(--border)', borderRadius: 8, padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>该知识库暂无文件</div>
            <div className="small muted" style={{ marginBottom: 12 }}>上传第一个文件后自动创建 Dify Dataset 并开始同步</div>
            <AsyncButton className="btn btn-primary btn-sm" onClick={() => setShowUpload(true)}>上传第一个文件</AsyncButton>
          </div>
        ) : (
          <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
            <thead><tr><th>文件名</th><th>类型</th><th>大小</th><th>切片数</th><th>密级</th><th>同步状态</th><th>操作</th></tr></thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td style={{ fontWeight: 500 }}>{f.name}<RecordId label="Dify 文档 ID" value={f.id} /></td>
                  <td className="muted small">{f.name.split('.').pop()?.toUpperCase()}</td>
                  <td className="muted small">{fmtSize(f.size)}</td>
                  <td className="muted small">{f.segmentTotal ?? '—'}</td>
                  <td><span className={`badge ${SEC[f.secLevel]?.cls ?? 'badge-neutral'}`}>{SEC[f.secLevel]?.label ?? '🔓 普通'}</span></td>
                  <td><span className={`badge ${STATUS_META[f.indexing_status]?.cls ?? 'badge-warning'}`}>{STATUS_META[f.indexing_status]?.label ?? f.indexing_status}</span></td>
                  <td>
                    <AsyncButton className="link" onClick={() => previewDoc(f.id, f.name)}>预览</AsyncButton>
                    <AsyncButton className="btn btn-secondary btn-sm" style={{ marginLeft: 10 }} disabled={!!importing || f.indexing_status !== 'completed'} onClick={() => createWiki(f.id)}>{importing === f.id ? '创建中…' : '创建 Wiki'}</AsyncButton>
                    <AsyncButton className="link" style={{ marginLeft: 10 }} onClick={() => setUpdatingId(f.id)}>更新</AsyncButton>
                    <AsyncButton className="link" style={{ marginLeft: 10 }} onClick={() => downloadApi(`/api/v1/tenant/knowledge/${id}/documents/${f.id}/download?tenantId=${TID}`, f.name).catch((e) => setMsg('❌ ' + e.message))}>下载</AsyncButton>
                    <AsyncButton className="link danger" style={{ marginLeft: 10 }} onClick={() => remove(f.id)}>删除</AsyncButton>
                    {updatingId === f.id && (
                      <span><input ref={updateRef} type="file" accept=".txt,.pdf,.docx,.xlsx" style={{ display: 'none' }}
                        onChange={(e) => e.target.files?.[0] && updateDoc(f.id, e.target.files[0])} />
                        <AsyncButton className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }} onClick={() => updateRef.current?.click()}>选择新文件</AsyncButton>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <div className="ai-warning" style={{ marginTop: 14 }}>
          ⚠ 文件密级参与动态知识权限计算（FR-010）：🔒 机密文件仅角色白名单包含该密级要求的角色可检索。
        </div>
      </div>

</> }, { id: 'pipeline', label: '切片流水线', content: <PipelineSettings datasetId={id} /> }]} />
      {/* 上传弹窗（multiple + 确认上传，对齐 knowledge-detail.html） */}
      {showUpload && (
        <ModalFrame title="上传文件 —" onClose={() => { !uploading && setShowUpload(false); }}>
          <div className="card" style={{ width: 480, maxWidth: '94vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="card-title">上传文件 — {kbName}</div>
              <AsyncButton closeDialog style={{ cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)' }} onClick={() => !uploading && setShowUpload(false)}>✕</AsyncButton>
            </div>
            <input ref={uploadRef} disabled={uploading} type="file" accept=".txt,.pdf,.docx,.xlsx" multiple style={{ width: '100%', padding: 12, border: '1px dashed var(--border)', borderRadius: 8, marginBottom: 10 }} onChange={(e) => setPendingFiles(Array.from(e.target.files ?? []))} />
            {pendingFiles.length > 0 && (
              <div className="small muted" style={{ marginBottom: 10 }}>已选 {pendingFiles.length} 个文件：{pendingFiles.map((f) => f.name).join('、')}</div>
            )}
            <div className="small" style={{ marginBottom: 6, color: 'var(--text-primary)', fontWeight: 500 }}>文件密级（决定哪些角色可检索）</div>
            <div className="flex gap-3" style={{ marginBottom: 12 }}>
              {[1, 2, 3].map((s) => (
                <label key={s} className="flex gap-3" style={{ gap: 5, fontSize: 13, cursor: 'pointer' }}>
                  <input type="radio" disabled={uploading} checked={secLevel === s} onChange={() => setSecLevel(s)} style={{ accentColor: 'var(--primary)' }} />
                  <span className={`badge ${SEC[s].cls}`}>{SEC[s].label}</span>
                </label>
              ))}
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="flex gap-3" style={{ gap: 6, fontSize: 13, cursor: 'pointer', marginBottom: 6 }}>
                <input type="checkbox" disabled checked={calcSec} onChange={(e) => setCalcSec(e.target.checked)} style={{ accentColor: 'var(--primary)' }} />
                密级参与动态知识权限计算（FR-010）
              </label>
              <label className="flex gap-3" style={{ gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" disabled checked={auditUpload} onChange={(e) => setAuditUpload(e.target.checked)} style={{ accentColor: 'var(--primary)' }} />
                检索审计记录密级（命中切片带密级落审计）
              </label>
            </div>
            <div className="small muted" style={{ marginBottom: 14 }}>单文件最大 15 MB，与当前 Dify 配置一致。超限会拒绝上传，不会只保留文件开头。上传后执行：文档提取 → 父子分块 → 原文句子切片 → 向量索引。套餐容量：{storageLimitMb > 0 ? `${storageLimitMb} MB` : '不限'}。</div>
            {msg && <Feedback message={msg} />}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <AsyncButton closeDialog className="btn btn-secondary" disabled={uploading} onClick={() => { setShowUpload(false); setPendingFiles([]); }}>取消</AsyncButton>
              <AsyncButton className="btn btn-primary" disabled={pendingFiles.length === 0 || uploading} onClick={confirmUpload}>{uploading ? '上传中…' : '确认上传'}</AsyncButton>
            </div>
          </div>
        </ModalFrame>
      )}

      {/* 预览弹窗（切片内容） */}
      {preview && (
        <ModalFrame title="预览 —" onClose={() => { setPreview(null); }} wide>
          <div className="card" style={{ width: 640, maxWidth: '94vw', maxHeight: '82vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="card-title">预览 — {preview.name}</div>
              <AsyncButton closeDialog style={{ cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)' }} onClick={() => setPreview(null)}>✕</AsyncButton>
            </div>
            <div className="small muted" style={{ marginBottom: 12 }}>共 {preview.total.toLocaleString()} 个父切片 · 第 {preview.page} / {Math.max(1, Math.ceil(preview.total / preview.limit))} 页。句子子切片可展开查看。</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              <AsyncButton className="btn btn-secondary" disabled={previewBusy || preview.page <= 1} onClick={() => previewDoc(preview.documentId, preview.name, 1)}>首页</AsyncButton>
              <AsyncButton className="btn btn-secondary" disabled={previewBusy || preview.page <= 1} onClick={() => previewDoc(preview.documentId, preview.name, preview.page - 1)}>上一页</AsyncButton>
              <AsyncButton className="btn btn-secondary" disabled={previewBusy || preview.page * preview.limit >= preview.total} onClick={() => previewDoc(preview.documentId, preview.name, preview.page + 1)}>下一页</AsyncButton>
              <AsyncButton className="btn btn-secondary" disabled={previewBusy || preview.page * preview.limit >= preview.total} onClick={() => previewDoc(preview.documentId, preview.name, Math.ceil(preview.total / preview.limit))}>末页</AsyncButton>
              {previewBusy && <span role="status">正在加载…</span>}
            </div>
            {preview.segments.map((s, i) => (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 8, fontSize: 13, lineHeight: 1.7, background: 'var(--bg-hover)' }}>
                <div className="small muted" style={{ marginBottom: 4 }}>切片 {s.position ?? i + 1}（{s.word_count ?? 0} 字）</div>
                {s.content}
                {!!s.child_chunks?.length && <details style={{ marginTop: 10 }}><summary>查看 {s.child_chunks.length} 个句子子切片</summary>{s.child_chunks.map((child, index) => <p key={child.id} style={{ padding: '8px 0', borderTop: '1px solid var(--border-light)' }}>{index + 1}. {child.content}</p>)}</details>}
              </div>
            ))}
            {preview.segments.length === 0 && <div className="small muted">暂无切片（索引处理中）</div>}
          </div>
        </ModalFrame>
      )}
      {wikiPageId && <Wiki initialPageId={wikiPageId} onClose={() => setWikiPageId('')} />}
    </>
  );
}
