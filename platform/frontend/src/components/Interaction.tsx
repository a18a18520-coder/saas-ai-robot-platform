import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';

type Notice = { id: number; text: string; kind: 'success' | 'error' | 'info' };
let notices: Notice[] = [];
const subscribers = new Set<() => void>();
type BackgroundTask = { id: number; label: string; state: 'running' | 'finished' | 'failed' };
let backgroundTasks: BackgroundTask[] = [];
const publish = () => subscribers.forEach(fn => fn());
const refreshOverlayTarget = () => queueMicrotask(() => { notices = [...notices]; backgroundTasks = [...backgroundTasks]; publish(); });
export function notify(text: string, kind: Notice['kind'] = 'success', duration = 3000) {
  const id = Date.now() + Math.random();
  notices = [...notices.slice(-2), { id, text, kind }]; publish();
  window.setTimeout(() => { notices = notices.filter(n => n.id !== id); publish(); }, duration);
}
export function useFeedback(): [string, (text: string) => void] {
  const [message, setMessage] = useState('');
  return [message, text => { if (text.startsWith('✅')) { setMessage(''); notify(text.replace(/^✅\s*/, '')); } else setMessage(text); }];
}
type Confirmation = { title: string; description: string; confirmText: string; match?: string; danger?: boolean; resolve: (value: boolean) => void };
let confirmations: Confirmation[] = [];
export function confirmAction(description: string, options: Partial<Omit<Confirmation, 'description' | 'resolve'>> = {}): Promise<boolean> {
  return new Promise(resolve => {
    const match = description.includes('不可恢复') ? description.match(/「([^」]+)」/)?.[1] : undefined;
    confirmations = [...confirmations, { title: '确认操作', confirmText: '确认删除', danger: !/启用|恢复/.test(options.confirmText ?? ''), match, ...options, description, resolve }]; publish();
  });
}
const subscribe = (fn: () => void) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; };
const CloseContext = createContext<((close?: () => void) => void) | null>(null);
const SavedContext = createContext<() => void>(() => {});
export const useDialogSaved = () => useContext(SavedContext);

/** 兼容既有操作提示：成功短暂通知，错误保留并显示在当前弹窗内。 */
export function Feedback({ message }: { message: string }) {
  const success = message.startsWith('✅');
  useEffect(() => { if (success) notify(message.replace(/^✅\s*/, '')); }, [message, success]);
  if (!message || success) return null;
  const content = <p className="ui-form-error" role="alert">{message.replace(/^❌\s*/, '')}</p>;
  const activeDialog = Array.from(document.querySelectorAll('dialog[open]')).at(-1);
  return activeDialog ? createPortal(content, activeDialog.querySelector('.m-body') ?? activeDialog) : content;
}
let scrollLocks = 0;
let savedOverflow = '';
let savedPadding = '';

/** 使用原生 dialog 管理焦点陷阱与背景 inert；表单不响应遮罩关闭。 */
export function ModalFrame({ children, onClose, title = '详情与配置', dirty, drawer = false, wide = false, initialFocus = 'field' }: {
  children: ReactNode; onClose: () => void; title?: string; dirty?: boolean; drawer?: boolean; wide?: boolean; initialFocus?: 'field' | 'cancel';
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [edited, setEdited] = useState(false);
  const closePending = useRef(false);
  const titleId = useId();
  const close = async (callback = onClose) => {
    if (closePending.current) return;
    closePending.current = true;
    try {
      if ((dirty ?? edited) && !await confirmAction('关闭后，本次尚未保存的修改将丢失。', { title: '放弃修改', confirmText: '放弃修改' })) return;
      callback();
    } finally { closePending.current = false; }
  };
  useEffect(() => {
    const node = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    if (scrollLocks++ === 0) {
      savedOverflow = document.body.style.overflow; savedPadding = document.body.style.paddingRight;
      const gap = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    }
    node.showModal();
    refreshOverlayTarget();
    const target = node.querySelector<HTMLElement>(initialFocus === 'cancel' ? '[data-dialog-close]' : 'input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled)');
    (target ?? node).focus();
    return () => {
      node.close();
      refreshOverlayTarget();
      if (--scrollLocks === 0) { document.body.style.overflow = savedOverflow; document.body.style.paddingRight = savedPadding; }
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [initialFocus]);
  return createPortal(<CloseContext.Provider value={close}>
    <dialog ref={dialog} tabIndex={-1} className={`ui-dialog${drawer ? ' ui-drawer' : ''}${wide ? ' ui-dialog-wide' : ''}`} aria-modal="true" aria-labelledby={titleId}
      onCancel={e => { e.preventDefault(); void close(); }} onChangeCapture={() => setEdited(true)}>
      <span id={titleId} className="sr-only">{title}</span>
      <SavedContext.Provider value={() => setEdited(false)}>{children}</SavedContext.Provider>
    </dialog>
  </CloseContext.Provider>, document.body);
}

export function Modal({ title, children, onClose, dirty, drawer, wide }: { title: string; children: ReactNode; onClose: () => void; dirty?: boolean; drawer?: boolean; wide?: boolean }) {
  return <ModalFrame title={title} onClose={onClose} dirty={dirty} drawer={drawer} wide={wide}>
    <div className="modal"><header className="m-head"><h2>{title}</h2><AsyncButton className="x" closeDialog aria-label="关闭" onClick={onClose}>×</AsyncButton></header><div className="m-body">{children}</div></div>
  </ModalFrame>;
}

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & { onClick?: (event: MouseEvent<HTMLButtonElement>) => unknown; closeDialog?: boolean };
export function AsyncButton({ onClick, disabled, children, closeDialog, ...props }: ButtonProps) {
  const close = useContext(CloseContext);
  const locked = useRef(false);
  const alive = useRef(true);
  const [pending, setPending] = useState(false), [spinner, setSpinner] = useState(false), [slow, setSlow] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function click(event: MouseEvent<HTMLButtonElement>) {
    if (locked.current || disabled) { event.preventDefault(); return; }
    if (closeDialog && close) { event.preventDefault(); close(() => { onClick?.(event); }); return; }
    locked.current = true;
    let delay: number | undefined, progress: number | undefined, background: number | undefined;
    let failed = false;
    const taskId = Date.now() + Math.random();
    const taskLabel = event.currentTarget.textContent?.trim() || '操作';
    try {
      const result = onClick?.(event);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        setPending(true);
        delay = window.setTimeout(() => { if (alive.current) setSpinner(true); }, 300);
        progress = window.setTimeout(() => { if (alive.current) setSlow(true); }, 3000);
        background = window.setTimeout(() => {
          backgroundTasks = [...backgroundTasks, { id: taskId, label: taskLabel, state: 'running' }]; publish();
          notify('请求仍在处理中，可继续浏览。请勿重复提交。', 'info');
        }, 10000);
        await result;
      }
    } catch (error) { failed = true; notify(error instanceof Error ? error.message : '操作失败，请重试', 'error'); }
    finally {
      clearTimeout(delay); clearTimeout(progress); clearTimeout(background); locked.current = false;
      if (backgroundTasks.some(task => task.id === taskId)) {
        backgroundTasks = backgroundTasks.map(task => task.id === taskId ? { ...task, state: failed ? 'failed' : 'finished' } : task); publish();
        notify(`${taskLabel}请求已结束，请查看操作结果。`, failed ? 'error' : 'info');
      }
      if (alive.current) { setPending(false); setSpinner(false); setSlow(false); }
    }
  }
  return <button type="button" {...props} data-dialog-close={closeDialog || undefined} disabled={disabled || pending} aria-busy={pending || undefined} onClick={click}>
    {spinner && <span className="ui-spinner" aria-hidden="true" />}{children}{slow && <span className="small" role="status">（仍在处理中）</span>}
  </button>;
}

export function InteractionHost() {
  const list = useSyncExternalStore(subscribe, () => notices);
  const queue = useSyncExternalStore(subscribe, () => confirmations);
  const tasks = useSyncExternalStore(subscribe, () => backgroundTasks);
  const current = queue[0];
  const [typed, setTyped] = useState('');
  const settle = (value: boolean) => { confirmations = confirmations.slice(1); setTyped(''); current.resolve(value); publish(); };
  return <>{current && <ModalFrame key={queue.length + current.description} title={current.title} dirty={false} onClose={() => settle(false)} initialFocus="cancel">
    <div className="modal"><header className="m-head"><h2>{current.title}</h2></header><div className="m-body"><p>{current.description}</p>{current.match && <label>输入「{current.match}」以确认<input className="input" value={typed} onChange={e => setTyped(e.target.value)} /></label>}</div><footer className="m-foot"><AsyncButton closeDialog className="btn btn-secondary" onClick={() => settle(false)}>取消</AsyncButton><AsyncButton className={`btn ${current.danger ? 'btn-danger' : 'btn-primary'}`} disabled={!!current.match && typed !== current.match} onClick={() => settle(true)}>{current.confirmText}</AsyncButton></footer></div>
  </ModalFrame>}{createPortal(<><div className="ui-notices" aria-live="polite" aria-atomic="false">{list.map(n => <div key={n.id} className={`ui-notice ui-notice-${n.kind}`} role={n.kind === 'error' ? 'alert' : 'status'}>{n.text}</div>)}</div>{!!tasks.length && <aside className="ui-background-tasks" aria-label="后台请求"><h3>后台请求</h3>{tasks.map(task => <div key={task.id}><span role="status">{task.label} · {task.state === 'running' ? '处理中' : task.state === 'failed' ? '请求失败' : '已结束'}</span>{task.state !== 'running' && <button type="button" className="link" onClick={() => { backgroundTasks = backgroundTasks.filter(t => t.id !== task.id); publish(); }} aria-label={`移除${task.label}记录`}>关闭</button>}</div>)}<p className="small muted">可在本页内切换功能；刷新或关闭浏览器会中断请求跟踪。</p></aside>}</>, Array.from(document.querySelectorAll('dialog[open]')).at(-1) ?? document.body)}</>;
}

/** 激活标签写入 URL；访问过的面板保持挂载，避免丢失表单和滚动位置。 */
export function Tabs({ items, param = 'tab' }: { items: Array<{ id: string; label: string; content: ReactNode; badge?: number }>; param?: string }) {
  const [search, setSearch] = useSearchParams();
  const active = items.some(i => i.id === search.get(param)) ? search.get(param)! : items[0].id;
  const [visited, setVisited] = useState<string[]>([active]);
  const id = useId();
  const visible = new Set([...visited, active]);
  useEffect(() => { setVisited(old => old.includes(active) ? old : [...old, active]); }, [active]);
  function select(value: string) { setSearch(old => { const next = new URLSearchParams(old); next.set(param, value); return next; }, { replace: true, preventScrollReset: true }); }
  return <div className="ui-tabs"><div role="tablist" className="ui-tablist" aria-label="页面内容">
    {items.map((item, index) => <button type="button" key={item.id} id={`${id}-${item.id}-tab`} role="tab" aria-selected={active === item.id} aria-controls={`${id}-${item.id}`} tabIndex={active === item.id ? 0 : -1} onClick={() => select(item.id)} onKeyDown={e => {
      let next = index;
      if (e.key === 'ArrowRight') next = (index + 1) % items.length;
      else if (e.key === 'ArrowLeft') next = (index + items.length - 1) % items.length;
      else if (e.key === 'Home') next = 0; else if (e.key === 'End') next = items.length - 1; else return;
      e.preventDefault(); select(items[next].id); document.getElementById(`${id}-${items[next].id}-tab`)?.focus();
    }}>{item.label}{item.badge != null && <span className="badge badge-neutral">{item.badge}</span>}</button>)}
  </div>{items.map(item => visible.has(item.id) && <section key={item.id} id={`${id}-${item.id}`} role="tabpanel" aria-labelledby={`${id}-${item.id}-tab`} hidden={item.id !== active} tabIndex={0}>{item.content}</section>)}</div>;
}

export function LoadState({ loading, error, empty, onRetry, children }: { loading?: boolean; error?: string; empty?: ReactNode; onRetry?: () => unknown; children: ReactNode }) {
  if (loading) return <div className="ui-skeleton" role="status" aria-label="正在加载"><span /><span /><span /></div>;
  if (error) return <div className="ui-empty" role="alert"><p>{error}</p>{onRetry && <AsyncButton className="btn btn-secondary" onClick={onRetry}>重新加载</AsyncButton>}</div>;
  if (empty) return <div className="ui-empty">{empty}</div>;
  return children;
}

export function usePageTab<T extends string>(fallback: T, values: readonly T[], param = 'tab'): [T, (value: T) => void] {
  const [search, setSearch] = useSearchParams();
  const value = search.get(param) as T;
  return [values.includes(value) ? value : fallback, next => setSearch(old => { const result = new URLSearchParams(old); result.set(param, next); return result; }, { replace: true, preventScrollReset: true })];
}

export function TabBar<T extends string>({ items, value, onChange, name = 'page' }: { items: ReadonlyArray<readonly [T, string]>; value: T; onChange: (value: T) => void; name?: string }) {
  return <div className="ui-tablist" role="tablist" aria-label="页面内容">{items.map(([key, label], index) => <button key={key} id={`${name}-${key}-tab`} type="button" role="tab" aria-selected={value === key} aria-controls={`${name}-${key}-panel`} tabIndex={value === key ? 0 : -1} onClick={() => onChange(key)} onKeyDown={e => {
    const next = e.key === 'ArrowRight' ? (index + 1) % items.length : e.key === 'ArrowLeft' ? (index + items.length - 1) % items.length : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
    if (next < 0) return; e.preventDefault(); onChange(items[next][0]); document.getElementById(`${name}-${items[next][0]}-tab`)?.focus();
  }}>{label}</button>)}</div>;
}

export function TabPanel({ id, active, children, name = 'page' }: { id: string; active: string; children: ReactNode; name?: string }) {
  const [visited, setVisited] = useState(active === id);
  useEffect(() => { if (active === id) setVisited(true); }, [active, id]);
  if (!visited && active !== id) return null;
  return <section role="tabpanel" tabIndex={0} hidden={active !== id} id={`${name}-${id}-panel`} aria-labelledby={`${name}-${id}-tab`}>{children}</section>;
}

export type PageLoadStatus = { loading: boolean; ready: boolean; error: string };
/** 首次加载使用骨架；刷新保留已挂载内容，避免列表筛选和弹窗状态丢失。 */
export function PageData({ state, onRetry, children }: { state: PageLoadStatus; onRetry: () => unknown; children: ReactNode }) {
  if (!state.ready) return <LoadState loading={state.loading} error={state.error} onRetry={onRetry}>{children}</LoadState>;
  return <>{state.loading && <p role="status" className="small muted">正在刷新数据…</p>}{state.error && <div role="alert" className="ui-form-error">{state.error} <AsyncButton className="btn btn-secondary" onClick={onRetry}>重新加载</AsyncButton></div>}{children}</>;
}
