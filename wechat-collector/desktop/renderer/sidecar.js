'use strict';
let sidecarMode = 'current', currentTask = null, currentPhase = '未启动', latestId = null, latestEpoch = 0, attached = false;
const chosenGroups = new Set();
window.selectedMonitorGroups = () => groups.filter(group => chosenGroups.has(group.id));
window.currentCaptureActive = () => !!currentTask;
window.isRotationEnabled = () => sidecarMode === 'specified' && $('auto-rotate').checked;
window.isCurrentGroupAllowed = id => sidecarMode === 'current' || chosenGroups.has(id);
window.toggleSpecifiedGroup = (id, checked) => {
  if (checked) chosenGroups.add(id); else chosenGroups.delete(id);
  $('capture-consent').checked = false; $('monitor-consent').checked = false;
  controls();
};
window.isSpecifiedGroup = id => chosenGroups.has(id);
const targetGroup = () => groups.find(group => group.id === $('current-group').value);
window.isCurrentSourceBound = () => !!source && targetGroup()?.sourceId === source.id;
window.isCurrentScrollReady = () => $('scroll-mode').value === 'none' || (controlReady && $('scroll-consent').checked);
window.monitorPhaseChanged = label => { currentPhase = label; controls(); };

window.sidecarControls = () => {
  const active = !!currentTask || window.collectorMonitorActive(), group = targetGroup();
  const configuring = !!window.isBindingConversation?.();
  const rotate = window.isRotationEnabled();
  $('sidecar-start').disabled = active || working || configuring || !stream || (rotate
    ? !controlReady || !chosenGroups.size || !$('monitor-consent').checked
    : !group || group.sourceId !== source?.id || !window.isCurrentGroupAllowed(group.id) || !$('capture-consent').checked || !window.isCurrentScrollReady());
  $('sidecar-start').textContent = rotate ? '开始轮巡' : '开始采集';
  $('sidecar-pause').disabled = !active;
  $('current-group').disabled = active || working || configuring;
  $('capture-consent').disabled = active || rotate;
  $('mode-current').disabled = active || working || configuring; $('mode-specified').disabled = active || working || configuring;
  $('monitor-consent').disabled = active || working || configuring;
  $('auto-rotate').disabled = active || working;
  $('dock').disabled = !stream;
  $('dock').textContent = attached ? '解除贴靠' : '贴靠微信';
  $('current-state').textContent = window.collectorMonitorActive() ? '轮巡中' : currentPhase;
  $('current-state').classList.toggle('active', active);
  for (const input of document.querySelectorAll('[data-group-choice]')) input.disabled = active || working || configuring;
  for (const edit of document.querySelectorAll('[data-group-edit]')) edit.disabled = active || working || configuring;
  $('monitor-start').disabled ||= !rotate || !chosenGroups.size;
};
window.refreshSidecar = async data => {
  const old = $('current-group').value, epoch = ++latestEpoch;
  $('current-group').replaceChildren(new Option('选择已校准会话', ''));
  for (const group of data.groups) $('current-group').add(new Option(group.name, group.id));
  if (data.groups.some(group => group.id === old)) $('current-group').value = old;
  const id = $('current-group').value;
  const rows = data.captures.filter(row => row.group?.id === id);
  latestId = rows.at(-1)?.id || null;
  $('open-review').disabled = !latestId;
  $('export-originals').disabled = !latestId;
  $('latest-meta').textContent = id ? `已采集 ${rows.length} 张原文截图${rows.length ? ` · 最近 ${new Date(rows.at(-1).capturedAt).toLocaleString('zh-CN')}` : ''}` : '请选择会话，或通过上方引导设置';
  $('latest-text').textContent = '此会话尚无原文。开始采集后显示最新识别结果。';
  if (latestId) {
    try {
      const row = await api('getCapture', latestId);
      if (epoch === latestEpoch) $('latest-text').textContent = row.ocrText || '此截图未识别到文字，请打开原图核对。';
    } catch (error) { if (epoch === latestEpoch) $('latest-text').textContent = error.message; }
  }
  controls();
};
window.focusCapturedGroup = id => { $('current-group').value = id; };
window.selectCalibratedGroup = id => { $('current-group').value = id; $('capture-consent').checked = false; currentPhase = '未启动'; };
const currentMonitor = new CurrentMonitor({
  frame: group => groupFrame(group),
  probe: group => groupFrame(group, false, true),
  start: (group, frame, options) => api('currentStart', { id: group.id, confirmed: $('capture-consent').checked, frame, ...options }),
  capture: async (group, session, frame) => {
    const result = await api('currentCapture', { id: group.id, token: session.token, frame });
    await refreshState(); return result;
  },
  scroll: (group, session, frame, direction) => api('currentScroll', { id: group.id, token: session.token, frame, direction }),
  stop: () => api('currentStop')
}, state => {
  const labels = { checking: '核验中', capturing: '识别中', waiting: '采集中', scrolling: '滚动中', paused: '已暂停' };
  currentPhase = labels[state.phase];
  if (state.phase === 'paused') { $('capture-consent').checked = false; $('scroll-consent').checked = false; status(state.reason, !state.reason.startsWith('本轮完成') && state.reason !== '已暂停；继续前请重新确认会话'); }
  else status(`仅采集“${targetGroup()?.name || ''}”：已检查 ${state.attempts} 次，新增 ${state.saved} 张截图。不会自动上传。`);
  controls();
});
window.pauseCurrentCapture = async () => {
  if (!currentTask) return;
  await currentMonitor.stop(); await currentTask;
};
window.startCurrentCapture = async limit => {
  if (currentTask || working || window.collectorMonitorActive()) throw new Error('请等待上一轮采集完全停止');
  const group = targetGroup();
  if (!stream || !group || !window.isCurrentGroupAllowed(group.id) || !$('capture-consent').checked) throw new Error('请选择允许采集的会话，并勾选确认');
  const intervalSeconds = Number($('interval').value), count = limit ?? Number($('count').value);
  running = true;
  // Install the task marker before start emits synchronous state notifications.
  const scroll = $('scroll-mode').value, historyScreens = Number($('current-history').value), scrollConfirmed = $('scroll-consent').checked;
  currentTask = Promise.resolve().then(() => currentMonitor.start(structuredClone(group), { intervalSeconds, count, scroll, historyScreens, scrollConfirmed })).finally(() => {
    running = false; currentTask = null; $('capture-consent').checked = false; $('scroll-consent').checked = false; controls();
  });
  controls(); await currentTask;
};
window.collector?.onMonitorStopped?.(() => {
  if (currentMonitor.active) currentMonitor.stop('采集已暂停。请重新确认会话、窗口及权限后再开始。');
});
async function switchMode(mode) {
  await window.pauseCurrentCapture(); await window.stopGroupMonitor();
  sidecarMode = mode; currentPhase = '未启动';
  $('mode-current').setAttribute('aria-pressed', String(mode === 'current'));
  $('mode-specified').setAttribute('aria-pressed', String(mode === 'specified'));
  $('specified-panel').hidden = mode !== 'specified';
  $('current-title').textContent = '2 · 选择会话';
  $('current-help').textContent = mode === 'current' ? '聊天标题变化即暂停；换聊天请重新选择或绑定。' : '仅轮巡勾选的会话，各会话独立保存。';
  $('auto-rotate').checked = mode === 'specified'; $('rotation-settings').hidden = mode !== 'specified';
  if (mode === 'specified' && Number($('interval').value) < 10) $('interval').value = '10';
  $('capture-consent').checked = false; $('monitor-consent').checked = false; $('scroll-consent').checked = false;
  status(mode === 'current' ? '选择一个已绑定会话，或绑定微信当前打开的聊天。' : '勾选轮巡目标，设置间隔和历史上限，确认后开始。'); controls();
}
action('mode-current', () => switchMode('current'));
action('mode-specified', () => switchMode('specified'));
action('sidecar-start', async () => { if (window.isRotationEnabled()) $('monitor-start').click(); else await window.startCurrentCapture(); });
action('sidecar-pause', async () => { await window.pauseCurrentCapture(); await window.stopGroupMonitor(); $('capture-consent').checked = false; $('monitor-consent').checked = false; $('scroll-consent').checked = false; });
$('auto-rotate').addEventListener('change', () => { $('rotation-settings').hidden = !$('auto-rotate').checked; $('capture-consent').checked = false; $('monitor-consent').checked = false; controls(); });
$('current-group').addEventListener('change', async () => {
  $('capture-consent').checked = false; $('scroll-consent').checked = false; currentPhase = '未启动';
  $('group-filter').value = $('current-group').value;
  try { await showCapture(''); await refreshState(); } catch (error) { status(error.message, true); }
});
action('open-review', async () => {
  $('review-panel').open = true; $('group-filter').value = $('current-group').value;
  await refreshState(); $('captures').value = latestId; await showCapture(latestId);
  $('review-panel').scrollIntoView({ block: 'start' });
});
for (const id of ['interval','count','scroll-mode','current-history','rotation-history']) $(id).addEventListener('input', () => {
  $('capture-consent').checked = false; $('scroll-consent').checked = false; $('monitor-consent').checked = false; controls();
});
$('scroll-consent').addEventListener('change', controls);
action('dock', async () => { const result = await api('dock', !attached); attached = result.attached; controls(); });
window.collector?.onDockState?.(state => { attached = state.attached; if (state.error) status(state.error, true); controls(); });
refreshState().catch(error => status(error.message, true));
