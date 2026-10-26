'use strict';
const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, safeStorage, nativeImage, systemPreferences, utilityProcess, globalShortcut, screen, powerMonitor, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { Store } = require('../src/core/store.cjs');
const { Ocr } = require('../src/core/ocr.cjs');
const { Uploader } = require('../src/core/uploader.cjs');
const { TenantSync } = require('../src/core/tenant-sync.cjs');
const { extractMessages } = require('../src/core/message-layout.cjs');
const { pngBytes, createCapture } = require('../src/core/validation.cjs');
const { groupConfig, assertTitleMatch } = require('../src/core/groups.cjs');
const { WindowControl } = require('../src/core/window-control.cjs');
const { CurrentSession } = require('../src/core/current-session.cjs');
const { dockBounds } = require('../src/core/docking.cjs');
const { rebindGroup, rawExport } = require('../src/core/onboarding.cjs');
const page = pathToFileURL(path.join(__dirname, 'renderer/index.html')).href;
const synthetic = !app.isPackaged && process.argv.includes('--synthetic-fixture');
if (synthetic) app.setPath('userData', path.resolve(__dirname, '../.runtime/synthetic-desktop'));
if (process.argv.includes('--smoke-check')) app.setPath('userData', path.join(app.getPath('temp'), 'wechat-collector-smoke'));
let win, store, ocr, uploader, tenantSync, syncTimer, selected = null, busy = false, ready = false, loadError = '';
let generation = 0;
let control, monitorGroups = null;
let currentSession, dockInspector, dockTimer, docking = false, dockingBusy = false, dockEpoch = 0;
const pauseShortcut = 'CommandOrControl+Shift+X';
if (!app.requestSingleInstanceLock()) app.quit();

function trusted(event) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== page) throw new Error('不允许的调用来源');
}
function handle(name, callback, requireStore = true) {
  ipcMain.handle(name, async (event, ...args) => {
    trusted(event);
    try {
      if (requireStore && !ready) throw new Error(loadError || '安全存储尚未就绪');
      return { ok: true, value: await callback(...args) };
    } catch (error) { return { ok: false, error: error.message || '操作失败，请重试' }; }
  });
}
async function windows() {
  let list;
  try { list = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false }); }
  catch { throw new Error('无法读取窗口列表。Mac 请检查“录屏与系统录音”权限；刚授权后请完全退出并重启采集助手。'); }
  return list.filter(source => source.name !== '微信信息采集助手');
}
async function stopMonitor() {
  monitorGroups = null; currentSession?.stop(); generation++; control?.stop(); globalShortcut.unregister(pauseShortcut);
  win?.webContents.send('monitor-stopped');
  await ocr.close();
}
function detach() {
  docking = false; dockEpoch++; clearInterval(dockTimer); dockInspector?.stop();
  if (win && !win.isDestroyed()) win.webContents.send('dock-state', { attached: false });
}
async function positionSidecar() {
  if (!selected || !win || win.isDestroyed()) throw new Error('请先连接微信窗口');
  if (dockingBusy) return;
  const epoch = dockEpoch, sourceId = selected.id;
  dockingBusy = true;
  try {
    const info = await dockInspector.run(sourceId, 'inspect');
    if (epoch !== dockEpoch || selected?.id !== sourceId) return;
    const physical = { x: info.x, y: info.y, width: info.width, height: info.height };
    const target = process.platform === 'win32' ? screen.screenToDipRect(null, physical) : physical;
    const bounds = dockBounds(target, screen.getDisplayMatching(target).workArea);
    if (!win.isMinimized()) {
      const old = win.getBounds();
      if (Object.keys(bounds).some(key => old[key] !== bounds[key])) win.setBounds(bounds, false);
    }
  } finally { dockingBusy = false; }
}
function monitored(id) {
  if (!monitorGroups?.includes(id)) throw new Error('轮巡未启动或该群未加入本轮');
  const group = snapshot().groups.find(row => row.id === id);
  if (!group || selected?.id !== group.sourceId) throw new Error('群窗口绑定已失效，请重新校准');
  return group;
}
async function ensureWindow(group) {
  const info = await control.run(group.sourceId, 'inspect');
  if (!group.nativeSize || Math.abs(info.width - group.nativeSize.width) > 1 || Math.abs(info.height - group.nativeSize.height) > 1) throw new Error('微信窗口尺寸已改变，请重新校准各群');
  return info;
}
async function verifyTitle(group, frame) {
  if (frame?.width !== group.geometry.width || frame?.height !== group.geometry.height) throw new Error('画面尺寸已改变，请重新校准');
  const bytes = pngBytes(frame.titleImage);
  const titleImageHash = createHash('sha256').update(bytes).digest('hex');
  if (group.titleImageHash && group.titleImageHash !== titleImageHash) throw new Error('群标题画面已变化，已暂停；请核对群名、成员数及窗口布局后重新校准');
  const size = nativeImage.createFromBuffer(bytes).getSize();
  if (size.width !== group.regions.title.width || size.height !== group.regions.title.height) throw new Error('群标题截图范围不匹配');
  const result = await ocr.recognize(bytes);
  assertTitleMatch(group.name, result);
  return titleImageHash;
}
function snapshot() {
  const data = store.snapshot();
  return data;
}
async function saveSyncedCapture(capture, id, phase, valid) {
  const result = await store.addGroupCapture(capture, id, phase, valid);
  if (result.saved && valid() && tenantSync.session) {
    const b = tenantSync.state().bindings.find(b => b.localGroupId === id && b.enabled && b.remoteEnabled);
    if (b) {
      const image = nativeImage.createFromBuffer(pngBytes(capture.image)), size = image.getSize();
      const observations = extractMessages({ bitmap: image.toBitmap(), ...size, lines: capture.lines, selfNickname: b.selfNickname });
      await tenantSync.observe(capture, id, observations);
    }
  }
  return result;
}
async function recognize(dataURL, sourceName, expectedGeneration = generation) {
  if (busy) throw new Error('正在识别上一张截图');
  const bytes = pngBytes(dataURL);
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error('截图无法解码');
  const capturedAt = new Date().toISOString();
  busy = true;
  try {
    const result = await ocr.recognize(bytes);
    if (expectedGeneration !== generation) throw new Error('采集已停止；本张结果未保存');
    const capture = createCapture({ dataURL, sourceName, capturedAt, ...result });
    await store.addCapture(capture);
    return capture;
  } catch (error) { await ocr.close().catch(() => {}); throw error; }
  finally { busy = false; }
}

app.whenReady().then(async () => {
  const resources = app.isPackaged ? path.join(process.resourcesPath, 'ocr') : path.join(__dirname, '../resources/ocr');
  ocr = new Ocr(resources, { spawn: entry => {
    const child = utilityProcess.fork(entry, [], { stdio: 'ignore', serviceName: '本地离线 OCR' });
    return { events: child, send: message => child.postMessage(message), kill: () => child.kill() };
  } });
  // No plaintext fallback: failures leave the original encrypted file untouched.
  store = new Store(path.join(app.getPath('userData'), 'collection.enc'), {
    encode: async value => { if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('系统加密存储不可用，未保存聊天数据'); return safeStorage.encryptStringAsync(value); },
    decode: async value => { if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('系统加密存储不可用'); return (await safeStorage.decryptStringAsync(value)).result; }
  });
  try { if (!['darwin', 'win32'].includes(process.platform)) throw new Error('当前仅支持 macOS / Windows'); await store.load(); if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('系统加密存储不可用，请检查钥匙串或 Windows 用户凭据'); ready = true; }
  catch { loadError = '无法打开加密存储。请检查系统钥匙串／用户权限；原文件已保留，不会覆盖。'; }
  uploader = new Uploader(store);
  tenantSync = new TenantSync(store, { deviceName: `${process.platform === 'darwin' ? 'Mac' : 'Windows'} 微信采集助手` });
  if (ready) await tenantSync.init();
  syncTimer = setInterval(() => { tenantSync.flush().catch(() => {}); }, 10000);
  control = new WindowControl(app.isPackaged ? path.join(process.resourcesPath, 'native') : path.join(__dirname, '../resources/native'));
  dockInspector = new WindowControl(control.directory);
  currentSession = new CurrentSession({
    group: id => snapshot().groups.find(group => group.id === id), source: () => selected?.id,
    inspect: ensureWindow, verify: verifyTitle, trust: info => control.assertTrusted(info),
    scroll: (group, direction) => control.run(group.sourceId, direction, group.geometry, group.regions.messages),
    focus: group => control.run(group.sourceId, 'focus', group.geometry, group.regions.messages),
    recognize: async (group, frame) => {
      const bytes = pngBytes(frame.messageImage), size = nativeImage.createFromBuffer(bytes).getSize();
      if (size.width !== group.regions.messages.width || size.height !== group.regions.messages.height) throw new Error('消息截图范围不匹配');
      const capturedAt = new Date().toISOString();
      const result = await ocr.recognize(bytes);
      return createCapture({ dataURL: frame.messageImage, sourceName: group.sourceName, capturedAt, ...result });
    },
    save: (capture, id, valid) => saveSyncedCapture(capture, id, 'current', valid)
  });
  powerMonitor.on('lock-screen', () => stopMonitor().catch(() => {}));
  powerMonitor.on('suspend', () => stopMonitor().catch(() => {}));
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(contents === win?.webContents && contents.getURL() === page && permission === 'display-capture' && !!selected));
  session.defaultSession.setPermissionCheckHandler((contents, permission) => contents === win?.webContents && contents.getURL() === page && permission === 'display-capture' && !!selected);
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (!selected || request.frame !== win.webContents.mainFrame || request.audioRequested) return callback({});
      const source = (await windows()).find(item => item.id === selected.id && item.name === selected.name);
      if (!source) return callback({});
      callback({ video: source });
    } catch { callback({}); }
  });

  handle('info', async () => ({ platform: process.platform, version: app.getVersion(), encrypted: await safeStorage.isAsyncEncryptionAvailable(), ready, loadError,
    accessibility: process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(false),
    screenPermission: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'system-managed' }), false);
  handle('sources', async () => (await windows()).map(({ id, name }) => ({ id, name })));
  handle('wechat-sources', async () => {
    if (busy || monitorGroups || currentSession.active) throw new Error('请先暂停采集');
    const candidates = (await windows()).filter(item => /^(微信|WeChat)(\s.*)?$/iu.test(item.name));
    const verified = [], inspector = new WindowControl(control.directory);
    for (const candidate of candidates) {
      try { await inspector.run(candidate.id, 'inspect'); verified.push({ id: candidate.id, name: candidate.name }); } catch { /* Not a visible verified WeChat window. */ }
    }
    return verified;
  });
  handle('open-screen-settings', async () => {
    if (busy || currentSession.active || monitorGroups) throw new Error('请先暂停采集');
    if (process.platform !== 'darwin') throw new Error('Windows 请重新连接微信窗口；若被系统策略阻止，请联系设备管理员。');
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    return true;
  }, false);
  handle('permission-status', async () => {
    const component = control.componentPath;
    try { await fs.access(component); } catch { return { available: false, trusted: false, error: '缺少窗口组件，请重新安装完整版本' }; }
    if (process.platform !== 'darwin') return { available: true, managed: true, trusted: false };
    const checker = new WindowControl(control.directory);
    try { return { available: true, ...(await checker.permissions()) }; }
    catch (error) { return { available: false, trusted: false, error: error.message }; }
  }, false);
  handle('open-control-settings', async () => {
    if (busy || currentSession.active || monitorGroups) throw new Error('请先暂停采集');
    if (process.platform !== 'darwin') throw new Error('Windows 权限由系统管理；若被拦截，请联系设备管理员。');
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    return true;
  }, false);
  handle('reveal-control', () => {
    if (busy || currentSession.active || monitorGroups) throw new Error('请先暂停采集');
    shell.showItemInFolder(control.componentPath); return true;
  }, false);
  handle('setup-layout', expanded => {
    if (busy || monitorGroups || currentSession.active) throw new Error('请先暂停采集');
    detach();
    const old = win.getBounds(), area = screen.getDisplayMatching(old).workArea;
    const width = Math.min(expanded === true ? 860 : 380, area.width);
    const height = Math.min(820, area.height);
    win.setBounds({ x: Math.max(area.x, Math.min(old.x, area.x + area.width - width)), y: Math.max(area.y, Math.min(old.y, area.y + area.height - height)), width, height });
    return true;
  });
  handle('rebind-group', async payload => {
    if (busy || monitorGroups || currentSession.active) throw new Error('请先暂停采集');
    busy = true;
    try { return await rebindGroup(payload, { group: id => snapshot().groups.find(row => row.id === id), source: () => selected, epoch: () => generation, inspect: ensureWindow, verify: verifyTitle, save: (group, valid) => store.saveGroup(group, valid) }); }
    finally { busy = false; }
  });
  handle('control-status', async () => {
    if (!selected) return { checked: false, trusted: false };
    if (busy || monitorGroups || currentSession.active) throw new Error('请停止采集并等待识别完成后检查权限');
    const current = selected.id;
    const info = await control.run(current, 'inspect');
    if (selected?.id !== current) throw new Error('窗口选择已改变，请重新检查');
    return { checked: true, trusted: info.trusted === true, componentPath: control.componentPath, platform: process.platform };
  });
  handle('select', async id => {
    if (busy || monitorGroups || currentSession.active) throw new Error('请先停止采集，再选择窗口');
    const source = (await windows()).find(item => item.id === id);
    if (!source) throw new Error('窗口已关闭，请刷新窗口列表');
    detach(); generation++; selected = { id: source.id, name: source.name };
    return selected;
  });
  handle('stop', async () => { detach(); selected = null; await stopMonitor(); return true; }, false);
  handle('capture', () => { throw new Error('请使用绑定会话的采集入口，不能仅凭窗口和消息区域采集'); });
  handle('dock', async enabled => {
    if (enabled !== true) { detach(); return { attached: false }; }
    if (dockingBusy) throw new Error('正在定位微信窗口，请稍后再试');
    detach();
    const epoch = dockEpoch, sourceId = selected?.id;
    await positionSidecar();
    if (epoch !== dockEpoch || sourceId !== selected?.id) throw new Error('窗口选择已改变，请重新贴靠');
    docking = true;
    dockTimer = setInterval(() => {
      if (!docking || dockingBusy) return;
      positionSidecar().catch(error => {
        detach(); win?.webContents.send('dock-state', { attached: false, error: error.message });
        stopMonitor().catch(() => {});
      });
    }, 1500);
    return { attached: true };
  });
  handle('current-start', async payload => {
    if (busy || monitorGroups || currentSession.active) throw new Error('已有采集正在运行');
    busy = true;
    try {
      if (!globalShortcut.register(pauseShortcut, () => stopMonitor().catch(() => {}))) {
        throw new Error('紧急暂停快捷键被占用，请释放后重试');
      }
      return await currentSession.start(payload);
    } catch (error) {
      await stopMonitor(); throw error;
    } finally { busy = false; }
  });
  handle('current-capture', async payload => {
    if (busy || monitorGroups) throw new Error('采集尚未就绪');
    busy = true;
    try { return await currentSession.capture(payload); }
    catch (error) { await stopMonitor(); throw error; }
    finally { busy = false; }
  });
  handle('current-stop', async () => { await stopMonitor(); return true; }, false);
  handle('current-scroll', async payload => {
    if (busy || monitorGroups) throw new Error('上一项采集或操作尚未结束');
    busy = true;
    try { return await currentSession.scroll(payload); }
    catch (error) { await stopMonitor(); throw error; }
    finally { busy = false; }
  });
  handle('state', () => { const data = snapshot(); return { ...data, captures: data.captures.map(({ image, ocrText, ...row }) => row) }; });
  handle('get-capture', id => { const row = snapshot().captures.find(item => item.id === id); if (!row) throw new Error('截图不存在'); return row; });
  handle('review', (id, input) => store.review(id, input));
  handle('tenant-login', input => tenantSync.login(input));
  handle('tenant-logout', () => { tenantSync.logout(); return tenantSync.state(); });
  handle('tenant-state', () => tenantSync.state());
  handle('tenant-groups', () => tenantSync.groups());
  handle('tenant-bind', input => tenantSync.bind(input));
  handle('tenant-flush', () => tenantSync.flush());
  handle('tenant-review', (id, input) => tenantSync.review(id, input));
  handle('tenant-discard', id => tenantSync.discard(id));
  handle('tenant-more', id => tenantSync.more(id));
  handle('save-group', async ({ config, frame }) => {
    if (busy || monitorGroups || currentSession.active) throw new Error('请先停止采集或等待识别完成');
    const group = groupConfig(config);
    if (selected?.id !== group.sourceId) throw new Error('请先连接对应微信窗口');
    const epoch = generation; busy = true;
    try {
      const info = await control.run(group.sourceId, 'inspect');
      const titleImageHash = await verifyTitle({ ...group, titleImageHash: null }, frame);
      if (generation !== epoch) throw new Error('校准已取消');
      return await store.saveGroup({ ...group, titleImageHash, nativeSize: { width: info.width, height: info.height } });
    } finally { busy = false; }
  });
  handle('monitor-start', async ({ ids, confirmed }) => {
    if (confirmed !== true) throw new Error('请确认允许切群和滚动');
    if (busy || monitorGroups || currentSession.active) throw new Error('已有采集正在运行');
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) throw new Error('请选择已校准的群');
    const epoch = generation; busy = true;
    try { for (const id of ids) {
      const group = snapshot().groups.find(row => row.id === id);
      if (!group || selected?.id !== group.sourceId) throw new Error('窗口已改变，请重新校准全部目标群');
      if (!group.titleImageHash) throw new Error('群标题尚未完成校准');
      if (!group.regions.entry) throw new Error('自动切群需要先校准该会话的左侧入口');
      control.assertTrusted(await ensureWindow(group));
    }
    if (generation !== epoch) throw new Error('启动已取消');
    if (!globalShortcut.register(pauseShortcut, () => stopMonitor().catch(() => {}))) throw new Error('紧急停止快捷键被占用，不能启动轮巡');
    generation++; monitorGroups = [...ids]; return true;
    } finally { busy = false; }
  });
  handle('monitor-stop', async () => { await stopMonitor(); return true; }, false);
  handle('monitor-action', async ({ id, action, frame }) => {
    const group = monitored(id), epoch = generation;
    if (!['activate','up','down'].includes(action) || busy) throw new Error('窗口操作未就绪');
    busy = true;
    try {
      await ensureWindow(group);
      if (action !== 'activate') await verifyTitle(group, frame);
      if (generation !== epoch || !monitorGroups) throw new Error('轮巡已停止');
      return await control.run(group.sourceId, action, group.geometry, group.regions[action === 'activate' ? 'entry' : 'messages']);
    } finally { busy = false; }
  });
  handle('monitor-capture', async ({ id, frame, phase }) => {
    const group = monitored(id), epoch = generation;
    if (busy || !['history','history-return','new'].includes(phase)) throw new Error('采集尚未就绪');
    busy = true;
    try {
      await ensureWindow(group); await verifyTitle(group, frame);
      const bytes = pngBytes(frame.messageImage), size = nativeImage.createFromBuffer(bytes).getSize();
      if (size.width !== group.regions.messages.width || size.height !== group.regions.messages.height) throw new Error('消息截图范围不匹配');
      const result = await ocr.recognize(bytes);
      if (generation !== epoch || !monitorGroups) throw new Error('采集已停止，本张结果未保存');
      const capture = createCapture({ dataURL: frame.messageImage, sourceName: group.sourceName, ...result });
      return await saveSyncedCapture(capture, group.id, phase, () => generation === epoch && monitorGroups?.includes(group.id));
    } finally { busy = false; }
  });
  handle('monitor-progress', async ({ id, progress }) => { monitored(id); return store.groupProgress(id, progress); });
  handle('export', async () => {
    const data = snapshot();
    if (!data.records.length && !data.syncMessages?.length) throw new Error('暂无可导出的核对记录或同步消息');
    const result = await dialog.showSaveDialog(win, { title: '导出已核对消息（包含聊天原文）', defaultPath: 'wechat-reviewed.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled) return { canceled: true };
    // Explicit export excludes screenshot data but includes immutable provenance.
    await fs.writeFile(result.filePath, JSON.stringify({ schemaVersion: 2, exportedAt: new Date().toISOString(), records: data.records, syncMessages: data.syncMessages || [] }, null, 2), { mode: 0o600 });
    return { count: data.records.length + (data.syncMessages?.length || 0) };
  });
  handle('export-raw', async groupId => {
    const data = rawExport(snapshot(), groupId);
    const result = await dialog.showSaveDialog(win, { title: '导出本会话原文（未核对，包含明文聊天）', defaultPath: 'wechat-originals.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled) return { canceled: true };
    await fs.writeFile(result.filePath, JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    return { count: data.captures.length };
  });
  handle('clear', async () => {
    if (busy || monitorGroups || currentSession.active || uploader.active.size || tenantSync.active) throw new Error('请先停止采集，并等待当前识别／发送结束');
    const result = await dialog.showMessageBox(win, { type: 'warning', buttons: ['取消', '清空本地数据'], defaultId: 0, cancelId: 0, message: '清空所有截图和核对记录？', detail: '此操作不可撤销。请先导出需要保留的记录；不会删除平台上的记录。' });
    if (result.response !== 1) return false;
    tenantSync.logout(); await store.clear(); return true;
  });
  handle('send', async (id, config) => uploader.send(id, config));
  handle('import-image', async () => {
    if (busy || monitorGroups || currentSession.active) throw new Error('请先停止采集，并等待识别完成');
    const result = await dialog.showOpenDialog(win, { title: '选择有权处理的聊天区域截图', properties: ['openFile'], filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    if ((await fs.stat(file)).size > 9000000) throw new Error('截图不能超过 9 MB');
    const dataURL = `data:image/png;base64,${(await fs.readFile(file)).toString('base64')}`;
    return recognize(dataURL, '手动导入截图');
  });

  win = new BrowserWindow({ width: 380, height: 820, minWidth: 360, minHeight: 540, title: '微信信息采集助手', show: !process.argv.includes('--smoke-check'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false, backgroundThrottling: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('close', () => { detach(); currentSession.stop(); generation++; selected = null; monitorGroups = null; control.stop(); globalShortcut.unregister(pauseShortcut); });
  await win.loadFile(path.join(__dirname, 'renderer/index.html'));
  if (synthetic) {
    const fixture = new BrowserWindow({ width: 820, height: 520, title: '采集验收专用 · 合成聊天', webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
    await fixture.loadFile(path.join(__dirname, 'fixture.html'));
    win.focus();
  }
  if (process.argv.includes('--smoke-check')) {
    const encrypted = await safeStorage.encryptStringAsync('collector synthetic encryption check');
    if ((await safeStorage.decryptStringAsync(encrypted)).result !== 'collector synthetic encryption check') throw new Error('Encryption round-trip failed');
    if (process.argv.includes('--smoke-ocr')) {
      const result = await ocr.recognize(await fs.readFile(path.join(resources, 'smoke-synthetic.png')));
      if (!/1\.2/.test(result.ocrText) || !/否/.test(result.ocrText) || !/DEVICE-DEMO-17/.test(result.ocrText)) throw new Error('Packaged OCR check failed');
      console.log('Packaged synthetic OCR passed.');
    }
    console.log(JSON.stringify({ loaded: true, platform: process.platform, ready, encrypted: await safeStorage.isAsyncEncryptionAvailable(), screenPermission: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'system-managed' }));
    await ocr.close();
    app.quit();
  }
}).catch(error => { console.error('Desktop initialization failed:', error.message); app.exit(1); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { clearInterval(syncTimer); tenantSync?.logout(); detach(); currentSession?.stop(); generation++; monitorGroups = null; control?.stop(); globalShortcut.unregister(pauseShortcut); ocr?.close().catch(() => {}); });
