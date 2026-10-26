'use strict';
let groups = [], groupStates = {}, editingGroup = null, monitorBusy = false, stoppingMonitor = false;
const phaseLabels = { switching: '切群核验', history: '读取历史', returning: '返回新消息', new: '检查新增', waiting: '等待下一轮', paused: '已暂停' };
let lastGroupData;
let monitorTask = null;
let controlReady = false, checkingControl = false;
window.collectorMonitorActive = () => monitorBusy || stoppingMonitor;
window.monitorControls = () => {
  const active = window.collectorMonitorActive();
  $('monitor-start').disabled = active || working || running || checkingControl || !controlReady || !stream || !groups.length || !$('monitor-consent').checked;
  $('check-control').disabled = active || working || running || checkingControl || !stream;
  $('monitor-stop').disabled = !active;
  $('group-save').disabled = active || working || running || !stream || !calibration.messages || !calibration.title || (!!window.isRotationEnabled?.() && !calibration.entry);
  $('group-new').disabled = active || working || running;
  $('roi-purpose').disabled = active || working || running;
};
window.refreshGroupUI = data => {
  lastGroupData = data; groups = data.groups || [];
  const chosen = $('group-filter').value;
  $('group-filter').replaceChildren(new Option('全部来源', ''));
  for (const group of groups) $('group-filter').add(new Option(group.name, group.id));
  if (groups.some(group => group.id === chosen)) $('group-filter').value = chosen;
  const body = $('monitor-groups'); body.replaceChildren();
  if (!groups.length) { const row = node('tr',''), cell = node('td','先连接微信窗口，再在下方校准并保存各群。','empty-cell'); cell.colSpan = 4; row.append(cell); body.append(row); }
  for (const group of groups) {
    const state = groupStates[group.id], row = node('tr',''), name = node('td','');
    const choice = document.createElement('input'); choice.type = 'checkbox'; choice.dataset.groupChoice = group.id;
    choice.checked = !!window.isSpecifiedGroup?.(group.id); choice.disabled = window.collectorMonitorActive() || working || running;
    choice.addEventListener('change', () => window.toggleSpecifiedGroup?.(group.id, choice.checked));
    const label = node('label','', 'check'); label.append(choice, node('span',group.name)); name.append(label);
    name.append(node('span',group.regions.entry ? '轮巡入口已设置' : '仅单会话 · 轮巡需补充左侧入口','subtext'));
    const info = node('td', state ? (monitorBusy ? phaseLabels[state.phase] : state.phase === 'paused' ? '已暂停' : '已停止') : '待启动');
    if (state?.error) info.append(node('span',state.error,'subtext error-text'));
    const count = node('td',`${data.captures.filter(capture => capture.group?.id === group.id).length} 张本地截图`);
    const actions = node('td',''), edit = node('button','重新校准'), view = node('button','查看内容');
    edit.disabled = window.collectorMonitorActive() || working || running;
    edit.dataset.groupEdit = group.id;
    edit.addEventListener('click', async () => {
      try { await window.editBoundConversation(group.id); } catch (error) { status(error.message, true); }
    });
    view.addEventListener('click', async () => { try { $('review-panel').open = true; $('group-filter').value = group.id; await showCapture(''); await refreshState(); $('group-filter').scrollIntoView({ block: 'center' }); } catch (error) { status(error.message, true); } });
    actions.append(view,edit); row.append(name,info,count,actions); body.append(row);
  }
  window.monitorControls();
};
function cropFrame(canvas, region) {
  const image = document.createElement('canvas'); image.width = region.width; image.height = region.height;
  image.getContext('2d').drawImage(canvas,region.x,region.y,region.width,region.height,0,0,region.width,region.height);
  return image.toDataURL('image/png');
}
async function groupFrame(group, fresh = true, titleOnly = false) {
  if (!stream?.active || source?.id !== group.sourceId) throw new Error('微信窗口流已断开，请重新连接和校准');
  const video = $('video');
  if (fresh) {
    await new Promise((resolve,reject) => { const timer = setTimeout(() => reject(new Error('微信画面未更新，已暂停')),5000); video.requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); }); });
    await new Promise((resolve,reject) => { const timer = setTimeout(() => reject(new Error('微信画面未更新，已暂停')),5000); video.requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); }); });
  }
  if (video.videoWidth !== group.geometry.width || video.videoHeight !== group.geometry.height) throw new Error('微信窗口尺寸发生改变，请重新校准');
  const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d').drawImage(video,0,0);
  return { width: canvas.width, height: canvas.height, clock: video.currentTime, titleImage: cropFrame(canvas,group.regions.title), ...(titleOnly ? {} : { messageImage: cropFrame(canvas,group.regions.messages) }) };
}
const groupMonitor = new GroupMonitor({
  activate: group => api('monitorAction',{id:group.id,action:'activate'}),
  frame: group => groupFrame(group),
  capture: async (group,frame,phase) => { const result = await api('monitorCapture',{id:group.id,frame,phase}); window.focusCapturedGroup?.(group.id); await refreshState(); return result; },
  scroll: (group,direction,frame) => api('monitorAction',{id:group.id,action:direction,frame}),
  progress: (group,progress) => api('monitorProgress',{id:group.id,progress}),
}, states => { groupStates = states; if (lastGroupData) window.refreshGroupUI(lastGroupData); });
window.stopGroupMonitor = async () => {
  if (!monitorBusy && !stoppingMonitor && !monitorTask) return;
  groupMonitor.stop(); stoppingMonitor = true; controls();
  try { await api('monitorStop'); await monitorTask; }
  finally { monitorBusy = false; stoppingMonitor = false; $('monitor-state').textContent = '已停止'; window.monitorPhaseChanged?.('已停止'); controls(); if (lastGroupData) window.refreshGroupUI(lastGroupData); }
};
window.collector?.onMonitorStopped?.(() => { groupMonitor.stop(); stoppingMonitor = !!monitorTask; $('monitor-state').textContent = stoppingMonitor ? '正在停止…' : '已停止'; controls(); });
action('group-new', () => {
  editingGroup = null;
  calibration = {}; roi = null; previewROI = null; draw();
  for (const id of ['group-name','group-chat-id','group-channel-id']) { $(id).value = ''; $(id).readOnly = false; }
  $('group-editing').textContent = '新会话配置。手动打开目标会话，重新冻结并校准标题与消息区域；自动轮巡另需左侧入口。';
  $('calibration-state').textContent = '标题与消息区域待重新选择；左侧入口仅自动轮巡需要。';
  controls();
});
action('group-save', async () => {
  if (!source || !frozen) throw new Error('请先连接窗口并冻结画面');
  working = true; controls(); status('正在核对当前群名并保存校准配置…');
  try {
    const config = { ...(editingGroup ? {id:editingGroup.id} : {}),name:$('group-name').value,chatId:$('group-chat-id').value,channelId:$('group-channel-id').value,sourceId:source.id,sourceName:source.name,geometry:{width:frozen.width,height:frozen.height},regions:calibration,historyScreens:Number($('group-history').value),intervalSeconds:Number($('group-interval').value) };
    const group = await api('saveGroup',{config,frame:await groupFrame(config)});
    editingGroup = group; await refreshState(); $('group-filter').value = group.id; window.selectCalibratedGroup?.(group.id); await refreshState();
    status(`已校准“${group.name}”，尚未启动。回到顶部确认后采集；指定会话模式须另行勾选。`);
    await window.onCalibrationSaved?.();
  } finally { working = false; }
});
action('monitor-start', async () => {
  if (monitorTask || window.collectorMonitorActive()) throw new Error('请等待上一轮完全停止');
  if (!window.isRotationEnabled?.()) throw new Error('请先显式开启自动切群');
  const intervalSeconds = Number($('interval').value), historyScreens = Number($('rotation-history').value);
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 10 || intervalSeconds > 3600 || !Number.isInteger(historyScreens) || historyScreens < 0 || historyScreens > 30) throw new Error('轮巡间隔须为 10–3600 秒；历史上限须为 0–30 屏');
  const selectedGroups = structuredClone(window.selectedMonitorGroups()).map(group => ({ ...group, intervalSeconds, historyScreens }));
  if (!selectedGroups.length || !stream) throw new Error('请先连接微信并保存群配置');
  working = true; controls();
  try { await api('monitorStart',{ids:selectedGroups.map(group=>group.id),confirmed:$('monitor-consent').checked}); }
  catch (error) { controlReady = false; $('monitor-permission').textContent = '启动检查未通过；处理上方提示后重新检查控制权限。'; throw error; }
  finally { working = false; }
  monitorBusy = true; $('monitor-state').textContent = '轮巡运行中'; status('轮巡已启动：请勿操作微信。截图只保存在本机，不会自动提交。'); controls();
  let failure = '';
  monitorTask = groupMonitor.start(selectedGroups).catch(error => { failure = error.message; }).finally(async () => {
    await api('monitorStop').catch(() => {}); monitorBusy = false; stoppingMonitor = false; monitorTask = null; $('monitor-consent').checked = false; $('monitor-state').textContent = '已停止'; controls();
    if (lastGroupData) window.refreshGroupUI(lastGroupData);
    const allPaused = Object.values(groupStates).length > 0 && Object.values(groupStates).every(state => state.phase === 'paused');
    window.monitorPhaseChanged?.(allPaused ? '已暂停' : '已停止');
    status(failure || (allPaused ? '所有目标群均已暂停，轮巡已停止。请查看各群错误原因；已保存内容仍在本机。' : '轮巡已停止，已采集的分群截图保留在本机。'), !!failure || allPaused);
  });
});
action('monitor-stop', async () => { await window.stopGroupMonitor(); status('轮巡已停止，已采集的分群截图保留在本机。'); });
$('monitor-consent').addEventListener('change', controls);
$('group-filter').addEventListener('change', async () => { try { await showCapture(''); await refreshState(); } catch (error) { status(error.message,true); } });
$('roi-purpose').addEventListener('change', () => { previewROI = null; draw(); const area = calibration[$('roi-purpose').value]; if (area) for (const key of ['x','y','width','height']) $(`roi-${key}`).value = area[key]; });
window.resetControlStatus = () => { controlReady = false; $('monitor-permission').textContent = '尚未检查窗口控制组件权限。连接微信预览后检查。'; };
window.refreshControlStatus = async () => {
  checkingControl = true; controlReady = false; controls();
  try {
    const info = await api('controlStatus');
    controlReady = info.checked === true && info.trusted === true;
    $('monitor-permission').textContent = controlReady
      ? '窗口控制组件权限检查通过。切群、滚动仍会逐次核验目标窗口和群标题。'
      : info.checked
        ? info.platform === 'win32' ? '所选微信窗口的控制被系统限制。请使用同一普通用户运行微信和助手；若有企业限制，请联系管理员，不要关闭安全保护。' : '窗口控制组件尚未获系统授权。请展开第 1 步“系统权限”，允许滚动与切群后重新检查；主应用授权不等于组件授权。'
        : '尚未检查窗口控制组件权限。请先连接微信预览。';
  } catch (error) { $('monitor-permission').textContent = `未能确认控制组件权限：${error.message}`; }
  finally { checkingControl = false; controls(); }
};
action('check-control', () => window.refreshControlStatus());
