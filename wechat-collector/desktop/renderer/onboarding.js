'use strict';
let guided = false, guidedRotation = false, setupInfo, permissionInfo, lastPermissionBlock, nextTarget;
window.isBindingConversation = () => guided;
window.onboardingControls = () => {
  const active = running || working || window.collectorMonitorActive();
  const group = groups.find(row => row.id === $('current-group').value);
  const bound = !!stream && group?.sourceId === source?.id;
  const rotate = !!window.isRotationEnabled?.();
  const scroll = $('scroll-mode').value !== 'none';
  $('saved-conversations').hidden = !groups.length;
  $('quick-connect').hidden = !!stream;
  $('quick-connect').disabled = active;
  $('bind-current').hidden = !stream;
  $('bind-current').disabled = active || guided;
  $('bind-current').textContent = rotate ? '添加当前打开的会话' : '绑定当前打开的聊天';
  $('quick-calibrate').hidden = !stream || !group;
  $('quick-calibrate').disabled = active || guided;
  $('quick-resume').hidden = !stream || !group || bound;
  $('quick-resume').disabled = active;
  $('first-capture').disabled = $('capture-one').disabled;
  for (const id of ['check-environment','screen-settings','control-settings','reveal-control','interval','count','scroll-mode','current-history','rotation-history','cancel-bind']) $(id).disabled = active;
  $('single-scroll-settings').hidden = rotate;
  $('capture-limit-settings').hidden = rotate;
  $('history-limit-field').hidden = rotate || $('scroll-mode').value !== 'up';
  $('capture-consent-label').hidden = rotate;
  $('scroll-consent-label').hidden = rotate || !scroll;
  $('monitor-consent-label').hidden = !rotate;
  $('control-preflight').hidden = !rotate && !scroll;
  $('scroll-help').hidden = !rotate && !scroll;
  $('scroll-consent').disabled = active;
  $('interval').min = rotate ? '10' : '2';
  $('frequency-help').textContent = rotate ? '依次处理；每个会话完成后等待，至少 10 秒。' : $('scroll-mode').value === 'up' ? '向上读取，到屏数上限或无变化时停止。' : $('scroll-mode').value === 'down' ? '向下滚动检查新增；每次完成后按间隔等待。' : '只读取可见消息；每次完成后按间隔等待。';
  $('quick-hint').textContent = guided ? '正在绑定：按下方预览提示框选并确认，不会改写旧会话。'
    : !stream ? '在微信打开目标聊天，再连接窗口。'
      : rotate ? '逐个打开聊天并添加，再勾选轮巡目标。'
        : !group ? '已连接，尚未采集。绑定当前聊天，或选择已绑定会话。'
          : !bound ? '请打开所选聊天，校验并恢复连接。'
            : '请核对微信当前打开的聊天与所选会话一致。';
  updatePermissionStep(false);
  const readiness = collectionReadiness({ info: setupInfo, active: running || window.collectorMonitorActive() || !!window.currentCaptureActive?.(), busy: working,
    connected: !!stream, guided, rotate, group, selected: window.selectedMonitorGroups?.() || [], sourceId: source?.id,
    scroll: $('scroll-mode').value, controlReady, checkingControl, interval: $('interval').value, count: $('count').value,
    history: $('current-history').value, rotationHistory: $('rotation-history').value,
    captureConsent: $('capture-consent').checked, scrollConsent: $('scroll-consent').checked, monitorConsent: $('monitor-consent').checked });
  $('run-hint').textContent = readiness.reason; nextTarget = readiness.target;
  $('show-next-step').hidden = !nextTarget;
  $('sidecar-start').disabled ||= !readiness.ready;
};
window.refreshOnboarding = () => window.onboardingControls();
function updatePermissionStep(collapseReady) {
  if (!setupInfo) return;
  const captureReady = setupInfo.platform !== 'darwin' || setupInfo.screenPermission === 'granted';
  const needsControl = !!window.isRotationEnabled?.() || $('scroll-mode').value !== 'none';
  // Global permission is not a verification of a selected window.
  const controlAvailable = stream ? controlReady : permissionInfo?.trusted === true;
  const blocked = !setupInfo.ready || !captureReady || (needsControl && !controlAvailable);
  $('permission-state').textContent = !setupInfo.ready ? '存储未就绪' : !captureReady ? '待录屏授权' : needsControl ? (controlAvailable ? '权限就绪' : '待控制授权') : '可截图';
  if (blocked && lastPermissionBlock !== blocked) $('permission-panel').open = true;
  if (!blocked && collapseReady) $('permission-panel').open = false;
  lastPermissionBlock = blocked;
}
action('show-next-step', () => {
  if (!nextTarget) return;
  const target = $(nextTarget);
  for (let ancestor = target; ancestor; ancestor = ancestor.parentElement) if (ancestor.tagName === 'DETAILS') ancestor.open = true;
  if (target.tagName === 'DETAILS') target.querySelector('summary').focus(); else target.focus();
  target.scrollIntoView({ block: 'center' });
});

async function checkEnvironment() {
  setupInfo = await api('info');
  try { permissionInfo = await api('permissionStatus'); } catch (error) { permissionInfo = { error: error.message, trusted: false }; }
  $('screen-settings').hidden = setupInfo.platform !== 'darwin';
  $('control-settings').hidden = setupInfo.platform !== 'darwin';
  $('reveal-control').hidden = setupInfo.platform !== 'darwin';
  const captureReady = setupInfo.platform !== 'darwin' || setupInfo.screenPermission === 'granted';
  $('permission-hint').textContent = !setupInfo.ready ? setupInfo.loadError : setupInfo.platform === 'preview' ? '合成验收：不申请系统权限，不操作真实微信。'
    : setupInfo.platform === 'darwin' ? `录屏：${captureReady ? '已允许' : '待允许'}。滚动与切群：${permissionInfo.trusted ? '组件已获授权' : '待授权；不滚动时可跳过'}。` : '窗口捕获由系统管理；滚动与切群在选择窗口后核验，不自动提权。';
  $('control-help').textContent = permissionInfo.error || '授权后请退出并重新打开助手。若主应用已授权但滚动仍不可用，定位下方控制组件，由你在系统设置中添加；不修改权限数据库。';
  if (stream && !running && !working && !window.collectorMonitorActive()) await window.refreshControlStatus?.();
  $('environment').textContent = `${setupInfo.platform === 'darwin' ? 'macOS' : setupInfo.platform === 'win32' ? 'Windows' : '界面验收'} · v${setupInfo.version || '测试'} · ${setupInfo.encrypted ? '系统加密存储' : '未启用加密存储'}`;
  updatePermissionStep(true); controls();
}
action('check-environment', checkEnvironment);
action('screen-settings', async () => { await api('openScreenSettings'); status('系统设置已打开。请由你本人确认录屏授权；应用不会自动开启权限。授权后退出并重新打开采集助手。'); });
action('control-settings', async () => { await api('openControlSettings'); status('请由你本人确认滚动/切群所需的辅助功能授权；完成后重新检查。'); });
action('reveal-control', async () => { await api('revealControl'); status('已在文件管理器中定位控制组件；仅定位，不会自动授权。'); });
action('quick-connect', async () => {
  working = true; controls(); status('正在查找已登录的微信窗口…');
  try {
    const list = await api('wechatSources');
    if (list.length !== 1) {
      $('setup-panel').open = true;
      $('sources').replaceChildren(new Option('请选择微信窗口', ''));
      for (const item of list) $('sources').add(new Option(item.name, item.id));
      throw new Error(list.length ? '发现多个微信窗口。请在下方选择要使用的窗口，再点“连接预览”。' : '未找到可用微信窗口。请打开并登录电脑版微信、取消最小化；Mac 可检查下方录屏权限后重试。');
    }
    $('sources').replaceChildren(new Option(list[0].name, list[0].id));
    await connectSource(list[0].id);
    await window.refreshControlStatus?.();
    status('已连接微信，尚未采集。请按引导确认会话和采集范围。');
  } finally { working = false; controls(); }
});
action('quick-resume', async () => {
  const group = groups.find(row => row.id === $('current-group').value);
  if (!group || !stream) throw new Error('请先连接微信并选择已保存会话');
  working = true; controls(); status('正在核验所选会话；仅在标题、尺寸一致时恢复…');
  try {
    const frame = await groupFrame({ ...group, sourceId: source.id });
    const saved = await api('rebindGroup', { id: group.id, confirmed: true, frame });
    window.selectCalibratedGroup(saved.id); await refreshState();
    status('会话已恢复，无需重新框选。勾选当前会话确认后即可开始采集。');
  } catch (error) { throw new Error(`${error.message}。请打开正确会话，或点“重新设置范围”；原记录保持不变。`); }
  finally { working = false; }
});
async function configureConversation(isNew) {
  if (!stream || running || working) throw new Error('请先连接微信并暂停采集');
  // Capture first; enlarging our own window never moves or clicks WeChat.
  freeze(); guided = true; guidedRotation = !!window.isRotationEnabled?.();
  $('calibration-state').textContent = guidedRotation ? '依次框选会话名、消息区和左侧入口。' : '依次框选会话名和消息区；无需左侧入口。';
  const group = isNew ? null : groups.find(row => row.id === $('current-group').value);
  editingGroup = group || null;
  for (const [id, value] of [['group-name', group?.name], ['group-chat-id', group?.chatId], ['group-channel-id', group?.channelId]]) { $(id).value = value || ''; $(id).readOnly = !!group; }
  $('setup-panel').open = true; $('group-config').open = true; $('guided-region').hidden = false;
  $('pick-entry').hidden = !guidedRotation;
  $('group-editing').textContent = group ? `调整“${group.name}”的范围，身份和原记录不变。` : '新会话：确认真实名称与范围，旧会话和原文保持不变。';
  chooseRegion('title');
  await api('setupLayout', true);
  $('guided-region').scrollIntoView({ block: 'start' });
  status(guidedRotation ? '依次框选会话名、消息区和左侧群入口，再确认绑定。请保持入口位置稳定。' : '框选会话名和消息区，再确认绑定；不用输入坐标或平台 ID。');
}
action('bind-current', () => configureConversation(true));
action('quick-calibrate', () => configureConversation(false));
window.editBoundConversation = async id => {
  if (!stream || running || working || window.collectorMonitorActive()) throw new Error('请先连接微信并暂停采集');
  if (!groups.some(group => group.id === id)) throw new Error('该会话已不存在，请重新选择');
  $('current-group').value = id; $('capture-consent').checked = false; $('scroll-consent').checked = false;
  await configureConversation(false); controls();
};
window.onPreviewDisconnected = () => {
  guided = false; editingGroup = null; $('guided-region').hidden = true;
};
action('cancel-bind', async () => {
  guided = false; $('guided-region').hidden = true; $('setup-panel').open = false;
  editingGroup = null; calibration = {}; roi = null; previewROI = null; draw();
  await api('setupLayout', false);
  status('已取消本次绑定，原会话和数据保持不变。');
});
function chooseRegion(purpose) {
  $('roi-purpose').value = purpose;
  $('pick-title').setAttribute('aria-pressed', String(purpose === 'title'));
  $('pick-messages').setAttribute('aria-pressed', String(purpose === 'messages'));
  $('pick-entry').setAttribute('aria-pressed', String(purpose === 'entry'));
  $('guided-instruction').textContent = purpose === 'title' ? '框住顶部完整会话名，避开右侧图标。' : purpose === 'messages' ? '框住聊天消息区，避开左侧列表和底部输入框。' : '框住左侧列表中此会话的入口；只用于轮巡切群。';
}
action('pick-title', () => chooseRegion('title'));
action('pick-messages', () => chooseRegion('messages'));
action('pick-entry', () => chooseRegion('entry'));
window.onRegionSelected = purpose => {
  if (!guided) return;
  if (purpose === 'title' && !calibration.messages) chooseRegion('messages');
  if (purpose === 'messages' && guidedRotation && !calibration.entry) chooseRegion('entry');
  if (calibration.title && calibration.messages && (!guidedRotation || calibration.entry)) {
    $('guided-instruction').textContent = '范围已选好。填写与微信一致的完整会话名，点击“确认并绑定”。';
    $('group-config').scrollIntoView({ block: 'center' }); $('group-name').focus();
  }
};
window.onCalibrationSaved = async () => {
  if (!guided) return;
  guided = false; $('guided-region').hidden = true; $('setup-panel').open = false;
  $('permission-panel').open = false;
  await api('setupLayout', false);
  $('current-group').scrollIntoView({ block: 'center' });
};
action('first-capture', () => begin(1));
action('export-originals', async () => { const result = await api('exportRaw', $('current-group').value); status(result.canceled ? '已取消导出。' : `已导出 ${result.count} 张截图的 OCR 原文（未经核对、不含图片）。这是明文文件，请妥善保管。`); });
checkEnvironment().catch(error => status(error.message, true));
controls();
