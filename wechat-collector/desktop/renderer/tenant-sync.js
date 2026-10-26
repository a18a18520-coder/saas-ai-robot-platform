'use strict';
(() => {
  const el = id => document.getElementById(id);
  if (!window.collector?.tenantState) { el('sync-notice').textContent = '当前预览不连接平台；正式桌面版支持租户登录。'; el('sync-login').disabled = true; return; }
  let state = { profile: null, bindings: [], messages: [] }, reviewing = null, signature = '', refreshing = false;
  const labels = { ready: '等待同步', pending_review: '待核对', synced: '平台已接收', conflict: '冲突 · 未覆盖', ignored: '已忽略', received: '等待处理', awaiting_robot: '待绑定收集机器人', processing: '提取中', collected: '已收集', needs_review: '提取待核对', failed: '提取失败', blocked: '已拦截', ignored_result: '规则忽略' };
  const call = async (name, ...args) => { const r = await window.collector[name](...args); if (!r.ok) throw new Error(r.error); return r.value; };
  const notice = message => { el('sync-notice').textContent = message; };
  const button = (text, action) => { const b = document.createElement('button'); b.textContent = text; b.addEventListener('click', () => run(b, action)); return b; };
  async function run(b, work) { const text = b.textContent; b.disabled = true; b.setAttribute('aria-busy', 'true'); b.textContent = '处理中…'; try { await work(); } catch (e) { notice(e.message); } finally { b.disabled = false; b.removeAttribute('aria-busy'); b.textContent = text; } }
  function mapping() {
    const b = state.bindings.find(b => b.localGroupId === el('sync-local-group').value);
    el('sync-self-name').value = b?.selfNickname || ''; el('sync-layout').checked = b?.layoutConfirmed || false;
    el('sync-enabled').checked = !!(b?.enabled && b.remoteEnabled); el('sync-consent').checked = false;
    el('sync-remote-group').disabled = !!b;
    if (b) {
      if (![...el('sync-remote-group').options].some(o => o.value === b.groupId)) el('sync-remote-group').add(new Option(b.remoteName || b.groupId, b.groupId));
      el('sync-remote-group').value = b.groupId;
      el('sync-mapping').textContent = `${b.localName} → ${b.remoteName || b.groupId} · ${b.remoteEnabled ? '平台允许同步' : '平台同步已停用'}。已有绑定不改归其他群。`;
    } else { el('sync-remote-group').value = ''; el('sync-mapping').textContent = '请选择对应群，或明确选择新建。不会按名称自动合并。'; }
  }
  function render(next) {
    const changed = state.profile?.accountId !== next.profile?.accountId || state.profile?.origin !== next.profile?.origin;
    state = next; const logged = !!state.profile;
    el('sync-login-form').hidden = logged; el('sync-connected').hidden = !logged;
    el('sync-summary').textContent = logged ? state.profile.tenantName : '未登录';
    if (!logged) { if (el('sync-review-dialog').open) el('sync-review-dialog').close(); reviewing = null; signature = ''; }
    if (state.error) notice(state.error);
    if (!logged) return;
    el('sync-identity').textContent = `${state.profile.tenantName} · ${state.profile.account}\n${state.profile.origin}`;
    const messages = [...state.messages].reverse(), pending = messages.filter(m => m.state === 'pending_review').length;
    el('sync-count').textContent = `${messages.length} 条 · ${pending} 待核对`; el('sync-empty').hidden = !!messages.length;
    const sig = JSON.stringify(messages); if (sig === signature && !changed) return; signature = sig;
    el('sync-messages').replaceChildren();
    for (const m of messages) {
      const row = document.createElement('article'), heading = document.createElement('strong'), text = document.createElement('p'), meta = document.createElement('p');
      heading.textContent = `${m.localName} · ${m.senderNickname || '发送人待确认'}${m.isSelf === true ? '（本人）' : ''}`;
      text.textContent = m.content || '请打开原始画面，核对单条消息。';
      meta.className = 'hint'; meta.textContent = `${labels[m.state] || m.state}${m.receipt ? ` · ${labels[m.receipt.processingStatus] || m.receipt.processingStatus}` : ''}${m.reason ? ` · ${m.reason}` : ''}`;
      row.append(heading, text, meta);
      if (m.state === 'pending_review') {
        const actions = document.createElement('div'); actions.className = 'actions';
        actions.append(button('核对原文', () => openReview(m)), button('忽略此候选', async () => { render(await call('tenantDiscard', m.id)); })); row.append(actions);
      } else if (['ready', 'synced', 'ignored'].includes(m.state)) row.append(button('同图补录另一条', async () => { render(await call('tenantMore', m.id)); }));
      el('sync-messages').append(row);
    }
  }
  async function refreshGroups() {
    if (!state.profile) return;
    const [remote, local] = await Promise.all([call('tenantGroups'), call('state')]);
    const selected = el('sync-local-group').value;
    el('sync-local-group').replaceChildren(new Option('请选择已绑定的本地会话', ''));
    for (const g of local.groups) el('sync-local-group').add(new Option(g.name, g.id));
    if (local.groups.some(g => g.id === selected)) el('sync-local-group').value = selected;
    el('sync-remote-group').replaceChildren(new Option('请选择已有微信群', ''), new Option('新建租户群（以此本地会话名创建）', '__new__'));
    for (const g of remote) { const o = new Option(`${g.name} · ${g.id.slice(0, 8)}${g.status === 'DISABLED' ? '（停用）' : ''}`, g.id); o.disabled = g.status === 'DISABLED'; el('sync-remote-group').add(o); }
    mapping();
  }
  el('sync-login-form').addEventListener('submit', e => { e.preventDefault(); run(el('sync-login'), async () => {
    try { render(await call('tenantLogin', { origin: el('sync-origin').value.trim(), account: el('sync-account').value.trim(), password: el('sync-password').value })); }
    finally { el('sync-password').value = ''; }
    notice('登录成功。选择本地会话和租户群，确认后开启同步。'); await refreshGroups();
  }); });
  el('sync-logout').addEventListener('click', () => run(el('sync-logout'), async () => { render(await call('tenantLogout')); notice('已退出。没有新的同步请求，未发送记录仍在本地。已到达平台的请求不会撤回。'); }));
  el('sync-refresh').addEventListener('click', () => run(el('sync-refresh'), async () => { render(await call('tenantFlush')); await refreshGroups(); if (!state.error) notice('群配置与平台回执已刷新。'); }));
  el('sync-local-group').addEventListener('change', mapping);
  for (const id of ['sync-remote-group','sync-self-name','sync-layout','sync-enabled']) el(id).addEventListener('input', () => { el('sync-consent').checked = false; });
  for (const id of ['sync-review-name','sync-review-self','sync-review-content','sync-review-time']) el(id).addEventListener('input', () => { el('sync-review-consent').checked = false; });
  el('sync-bind').addEventListener('click', () => run(el('sync-bind'), async () => {
    const target = el('sync-remote-group').value;
    if (!target) throw new Error('请选择租户已有群或确认新建');
    render(await call('tenantBind', { localGroupId: el('sync-local-group').value, groupId: target === '__new__' ? null : target, createNew: target === '__new__',
      enabled: el('sync-enabled').checked, confirmed: el('sync-consent').checked, selfNickname: el('sync-self-name').value, layoutConfirmed: el('sync-layout').checked }));
    await refreshGroups(); el('sync-config').open = false; notice('会话设置已保存。同步不补传旧截图；新群需在租户端绑定已发布的收集机器人才能提取字段。');
  }));
  async function openReview(m) {
    const capture = await call('getCapture', m.captureId); reviewing = m;
    el('sync-review-group').textContent = `${state.profile.tenantName} / ${m.localName}`; el('sync-review-image').src = capture.image;
    el('sync-review-name').value = m.senderNickname; el('sync-review-self').value = m.isSelf === true ? 'self' : m.isSelf === false ? 'other' : '';
    el('sync-review-content').value = m.content; el('sync-review-time').value = m.sentAtRaw || ''; el('sync-review-consent').checked = false; el('sync-review-error').textContent = '';
    el('sync-review-dialog').showModal();
  }
  el('sync-review-close').addEventListener('click', () => el('sync-review-dialog').close());
  el('sync-review-dialog').addEventListener('close', () => { reviewing = null; el('sync-review-image').removeAttribute('src'); });
  el('sync-review-form').addEventListener('submit', e => { e.preventDefault(); if (!reviewing) return;
    run(el('sync-review-save'), async () => {
      try {
        render(await call('tenantReview', reviewing.id, { senderNickname: el('sync-review-name').value, isSelf: el('sync-review-self').value === 'self', content: el('sync-review-content').value,
          sentAtRaw: el('sync-review-time').value, confirmed: el('sync-review-consent').checked }));
        el('sync-review-dialog').close(); notice('已加入同步队列；会话同步开启时自动发送。');
      } catch (error) { el('sync-review-error').textContent = error.message; }
    });
  });
  async function poll() { if (refreshing) return; refreshing = true; try { render(await call('tenantState')); } catch (e) { notice(e.message); } finally { refreshing = false; } }
  poll(); const timer = setInterval(poll, 4000);
  window.addEventListener('beforeunload', () => { clearInterval(timer); el('sync-password').value = ''; });
})();
