import { useFeedback, usePageTab, TabBar, TabPanel, Modal, PageData, Feedback, confirmAction, AsyncButton } from '../components/Interaction';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { todayStamp } from '../api/datetime';

interface Word {
  id: string; word: string; listType: 'black' | 'white'; category: string;
  action: 'REPLACE' | 'REJECT' | 'ALERT'; scope?: string; note?: string; hitCount?: number; isActive: boolean;
}

const ACTION_LABEL: Record<string, string> = { REPLACE: '替换 ***', REJECT: '拒绝回复', ALERT: '仅记录告警' };
const CATEGORIES = ['政治', '色情', '暴力', '竞品词', '自定义'];

/** 内容黑白名单（FR-023，对齐 content-filter.html）——平台级敏感词过滤（真实 API） */
export default function ContentFilter() {
  const [tab, setTab] = usePageTab('black', ["black","white"] as const);
  const [words, setWords] = useState<Word[]>([]);
  const [msg, setMsg] = useFeedback();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ word: '', listType: 'black', category: '自定义', action: 'REPLACE', scope: '全局', note: '' });
  // 黑名单筛选（content-filter.html：搜索/分类/动作）+ 批量导入
  const [keyword, setKeyword] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importCategory, setImportCategory] = useState('自定义');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const [pageLoad, setPageLoad] = useState({ loading: true, ready: false, error: '' });
  async function load() {
    setPageLoad(old => ({ ...old, loading: true, error: '' }));
    try { setWords(await api<Word[]>('/api/v1/admin/content-filter'));
      setPageLoad({ loading: false, ready: true, error: '' });
    } catch (cause) { setPageLoad(old => ({ ...old, loading: false, error: (cause as Error).message })); }
  }
  useEffect(() => { load().catch(() => {}); }, []);

  const black = words.filter((w) => w.listType === 'black');
  const white = words.filter((w) => w.listType === 'white');
  const blackFiltered = black.filter((w) =>
    (!keyword || w.word.includes(keyword)) &&
    (!categoryFilter || w.category === categoryFilter) &&
    (!actionFilter || w.action === actionFilter));
  const totalHits = words.reduce((a, w) => a + (w.hitCount ?? 0), 0);

  async function add() {
    if (!form.word.trim()) { setMsg('❌ 请输入词条'); return; }
    try {
      await api('/api/v1/admin/content-filter', { method: 'POST', body: JSON.stringify(form) });
      setMsg(`✅ 词条「${form.word}」已新增`); setShowAdd(false); setForm({ word: '', listType: 'black', category: '自定义', action: 'REPLACE', scope: '全局', note: '' }); load();
    } catch (e) { setMsg('❌ ' + (e as Error).message); }
  }

  /** 批量导入：一行一词（可 "词条,分类"），逐条 POST 真实落库 */
  async function runImport() {
    const lines = importText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { setMsg('❌ 请粘贴词条（一行一词，或 "词条,分类"）'); return; }
    setImporting(true);
    let ok = 0; const failed: string[] = [], failures: string[] = []; setImportErrors([]);
    for (const line of lines) {
      const [word, cat] = line.split(',').map((s) => s.trim());
      try {
        await api('/api/v1/admin/content-filter', {
          method: 'POST',
          body: JSON.stringify({ word, listType: 'black', category: cat || importCategory, action: 'REPLACE', scope: '全局' }),
        });
        ok++;
      } catch (cause) { failed.push(line); failures.push(`${word}：${(cause as Error).message}`); }
    }
    setImportErrors(failures); setImportText(failed.join('\n'));
    setMsg(failed.length ? `成功 ${ok} 条，失败 ${failed.length} 条。已保留失败词条，修正后可重试。` : `✅ 已导入 ${ok} 条词条`);
    if (!failed.length) setShowImport(false); setImporting(false); await load();
  }

  /** 导出词库 CSV（content-filter.html 页头按钮） */
  function exportCsv() {
    const head = '词条,名单,分类,拦截动作,作用域,命中次数,状态\n';
    const body = words.map((w) => [w.word, w.listType === 'black' ? '黑名单' : '白名单', w.category, ACTION_LABEL[w.action] ?? w.action, w.scope ?? '全局', w.hitCount ?? 0, w.isActive ? '启用' : '停用'].join(',')).join('\n');
    const blob = new Blob(['﻿' + head + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `content-filter-${todayStamp()}.csv`;
    a.click();
  }

  async function toggle(w: Word) {
    // 后端为 PATCH :id/active（此前误用 POST 导致启停 404）
    await api(`/api/v1/admin/content-filter/${w.id}/active`, { method: 'PATCH', body: JSON.stringify({ isActive: !w.isActive }) });
    load();
  }

  async function remove(w: Word) {
    if (!(await confirmAction(`确认删除词条「${w.word}」？`, { confirmText: '确认删除' }))) return;
    await api(`/api/v1/admin/content-filter/${w.id}`, { method: 'DELETE' });
    setMsg(`✅ 已删除「${w.word}」`); load();
  }

  return (
    <><PageData state={pageLoad} onRetry={load}>
      <div className="page-header">
        <div>
          <h1>内容黑白名单</h1>
          <div className="desc">黑名单拦截违规内容 · 白名单豁免误杀词 · 全局应用到所有租户 AI 输入/输出（内容合规 🚨 风险项落地）</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <AsyncButton className="btn btn-secondary" onClick={exportCsv}>⬇ 导出词库</AsyncButton>
          <AsyncButton className="btn btn-secondary" onClick={() => { setShowImport(!showImport); setShowAdd(false); }}>⇪ 批量导入</AsyncButton>
          <AsyncButton className="btn btn-primary" onClick={() => { setShowAdd(!showAdd); setShowImport(false); }}>+ 新增词条</AsyncButton>
        </div>
      </div>

      {msg && <Feedback message={msg} />}

      <div className="metrics" style={{ marginBottom: 14 }}>
        <div className="metric"><div className="m-label">🛑 黑名单</div><div className="m-value">{black.length}</div><div className="m-sub">拦截词条</div></div>
        <div className="metric"><div className="m-label">✅ 白名单</div><div className="m-value">{white.length}</div><div className="m-sub">豁免词条</div></div>
        <div className="metric"><div className="m-label">🎯 累计命中</div><div className="m-value">{totalHits}</div><div className="m-sub">全部词条命中计数</div></div>
        <div className="metric"><div className="m-label">过滤状态</div><div className="m-value" style={{ fontSize: 20 }}>🟢 全局生效</div><div className="m-sub">输入 + 输出双向过滤</div></div>
      </div>

      <TabBar items={[["black","黑名单"],["white","白名单"]] as const} value={tab} onChange={setTab} />

      {showAdd && <Modal title="新增词条" drawer onClose={() => setShowAdd(false)}><div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title" style={{ marginBottom: 12 }}>新增词条</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <input className="input" placeholder="词条内容 *" value={form.word} onChange={(e) => setForm({ ...form, word: e.target.value })} />
            <select className="select" value={form.listType} onChange={(e) => setForm({ ...form, listType: e.target.value })}>
              <option value="black">黑名单</option><option value="white">白名单</option>
            </select>
            <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className="select" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
              <option value="REPLACE">替换 ***</option><option value="REJECT">拒绝回复</option><option value="ALERT">仅记录告警</option>
            </select>
            <select
              className="select"
              value={form.scope === '全局' || !form.scope ? '全局' : '指定租户'}
              onChange={(e) => setForm({ ...form, scope: e.target.value === '全局' ? '全局' : (form.scope && form.scope !== '全局' ? form.scope : '指定:') })}
            >
              <option value="全局">作用域：全局（所有租户）</option>
              <option value="指定租户">作用域：指定租户</option>
            </select>
            {form.scope !== '全局' && form.scope !== undefined && (
              <input
                className="input"
                placeholder="租户 ID（如 9fa63b5b-f8d3…）"
                value={form.scope.startsWith('指定:') ? form.scope.slice(3) : ''}
                onChange={(e) => setForm({ ...form, scope: `指定:${e.target.value.trim()}` })}
              />
            )}
            <input className="input" placeholder="白名单豁免说明（白名单时）" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
            <AsyncButton closeDialog className="btn btn-secondary" onClick={() => setShowAdd(false)}>取消</AsyncButton>
            <AsyncButton className="btn btn-primary" onClick={add}>新增</AsyncButton>
          </div>
        </div></Modal>}

      {showImport && <Modal title="批量导入黑名单" onClose={() => setShowImport(false)}><div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title" style={{ marginBottom: 12 }}>批量导入黑名单</div>{!!importErrors.length && <ul className="ui-form-error" role="alert">{importErrors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
          <div className="small muted" style={{ marginBottom: 8 }}>一行一词；也可「词条,分类」。逐条落库并即时生效（导入后可在下方筛选核验）。</div>
          <textarea className="input mono" rows={5} style={{ width: '100%', marginBottom: 10 }} placeholder={'竞品A\n违禁词B,暴力\n违禁词C,色情'} value={importText} onChange={(e) => setImportText(e.target.value)} />
          <div className="flex gap-3" style={{ marginBottom: 12 }}>
            <select className="select" value={importCategory} onChange={(e) => setImportCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <span className="small muted" style={{ alignSelf: 'center' }}>{importText.split('\n').filter((l) => l.trim()).length} 行待导入</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <AsyncButton closeDialog className="btn btn-secondary" onClick={() => setShowImport(false)}>取消</AsyncButton>
            <AsyncButton className="btn btn-primary" disabled={importing} onClick={runImport}>{importing ? '导入中…' : '确认导入'}</AsyncButton>
          </div>
        </div></Modal>}

      <TabPanel id="black" active={tab}><>
          <div className="flex gap-3" style={{ marginBottom: 12 }}>
            <input className="input" style={{ width: 200 }} placeholder="搜索词条…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            <select className="select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">全部分类</option>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className="select" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="">全部动作</option>
              <option value="REPLACE">替换 ***</option>
              <option value="REJECT">拒绝回复</option>
              <option value="ALERT">仅记录告警</option>
            </select>
            <span className="small muted" style={{ alignSelf: 'center' }}>{blackFiltered.length} 条</span>
          </div>
          <div className="card">
            <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
              <thead><tr><th>词条</th><th>分类</th><th>拦截动作</th><th>命中次数</th><th>作用域</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                {blackFiltered.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 500 }}>{r.word}</td>
                    <td><span className="badge badge-error">{r.category}</span></td>
                    <td>{ACTION_LABEL[r.action] ?? r.action}</td>
                    <td className="muted">{r.hitCount ?? 0} 次</td>
                    <td className="muted">{r.scope ?? '全局'}</td>
                    <td><span className={`badge ${r.isActive ? 'badge-success' : 'badge-warning'}`}>{r.isActive ? '启用' : '停用'}</span></td>
                    <td>
                      <AsyncButton className="link" onClick={() => toggle(r)}>{r.isActive ? '停用' : '启用'}</AsyncButton>
                      <AsyncButton className="link" style={{ marginLeft: 10, color: 'var(--error)' }} onClick={() => remove(r)}>删除</AsyncButton>
                    </td>
                  </tr>
                ))}
                {blackFiltered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 24 }}>{black.length ? '无匹配词条' : '暂无黑名单词条'}</td></tr>}
              </tbody>
            </table></div>
          </div>
        </></TabPanel>

      <TabPanel id="white" active={tab}><div className="card">
          <div className="ui-table-scroll" tabIndex={0} role="region" aria-label="数据表格"><table className="data">
            <thead><tr><th>词条</th><th>分类</th><th>豁免说明</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {white.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>{r.word}</td>
                  <td><span className="badge badge-info">{r.category}</span></td>
                  <td className="muted small">{r.note ?? '—'}</td>
                  <td><span className={`badge ${r.isActive ? 'badge-success' : 'badge-warning'}`}>{r.isActive ? '启用' : '停用'}</span></td>
                  <td>
                    <AsyncButton className="link" onClick={() => toggle(r)}>{r.isActive ? '停用' : '启用'}</AsyncButton>
                    <AsyncButton className="link" style={{ marginLeft: 10, color: 'var(--error)' }} onClick={() => remove(r)}>删除</AsyncButton>
                  </td>
                </tr>
              ))}
              {white.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-placeholder)', padding: 24 }}>暂无白名单词条</td></tr>}
            </tbody>
          </table></div>
          <div className="ai-warning info mt-4">
            <span className="ic">📌</span>
            <div>白名单词条命中黑名单时豁免放行（仅记录告警）。白名单优先于黑名单，用于豁免误杀的正常业务词。</div>
          </div>
        </div></TabPanel>
    </PageData></>
  );
}
