'use strict';
const $ = id => document.getElementById(id);
let stream, source, frozen, roi, capture, running = false, working = false, turn = 0, timer;
let records = [];
let syncRecordCount = 0;
let calibration = {}, previewROI = null;
const context = $('selection').getContext('2d');
const labels = { processing: '平台处理中', collected: '提取成功', needs_review: '平台待核对', ignored: '未命中规则', failed: '提取失败', blocked: '已拦截' };
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); if (error) $('status').scrollIntoView({ block: 'nearest' }); }
async function api(method, ...args) { if (!window.collector) throw new Error('请在桌面应用中打开此页面'); const result = await window.collector[method](...args); if (!result.ok) throw new Error(result.error); return result.value; }
function action(id, callback) { $(id).addEventListener('click', async () => { try { await callback(); } catch (error) { status(error.message, true); } finally { controls(); } }); }
function controls() {
  const multi = !!window.collectorMonitorActive?.();
  const canCapture = !!stream && !!window.isCurrentSourceBound?.() && !!$('current-group').value && $('capture-consent').checked && !running && !working && !multi && !window.isBindingConversation?.() && !window.isRotationEnabled?.() && !!window.isCurrentGroupAllowed?.($('current-group').value);
  $('capture-one').disabled = !canCapture || !(window.isCurrentScrollReady?.() ?? true); $('start').disabled = $('capture-one').disabled;
  $('stop').disabled = !stream && !running;
  $('connect').disabled = running || working || multi; $('refresh').disabled = running || working || multi;
  $('import-image').disabled = running || working || multi;
  $('freeze').disabled = !stream || running || working || multi;
  $('apply-region').disabled = !frozen || running || working || multi;
  $('review').disabled = !capture || !$('review-consent').checked;
  $('clear').disabled = running || working || multi;
  $('export').disabled = !records.length && !syncRecordCount;
  window.monitorControls?.();
  window.sidecarControls?.();
  window.onboardingControls?.();
}
function node(tag, content, className) { const element = document.createElement(tag); element.textContent = content; if (className) element.className = className; return element; }
async function refreshState() {
  const data = await api('state'); records = data.records; syncRecordCount = data.syncMessages?.length || 0;
  window.refreshGroupUI?.(data);
  const inGroup = row => !$('group-filter').value || row.group?.id === $('group-filter').value;
  const previous = $('captures').value;
  $('captures').replaceChildren(new Option('选择待核对截图', ''));
  for (const item of data.captures.filter(inGroup).slice().reverse()) $('captures').add(new Option(`${item.group?.name || item.sourceName} · ${new Date(item.capturedAt).toLocaleTimeString('zh-CN')} · ${Math.round(item.confidence)}%`, item.id));
  if (data.captures.some(item => item.id === previous && inGroup(item))) $('captures').value = previous;
  $('capture-count').textContent = `${data.captures.filter(inGroup).length} 张截图 / 总计 ${data.captures.length}`;
  $('record-count').textContent = `${records.filter(inGroup).length} / 总计 ${records.length}`;
  $('records').replaceChildren();
  if (!records.filter(inGroup).length) { const row = node('tr', ''); const cell = node('td', '此来源还没有已核对的消息。请先选择截图并核对原文。', 'empty-cell'); cell.colSpan = 5; row.append(cell); $('records').append(row); }
  for (const record of records.filter(inGroup).slice().reverse()) {
    const row = document.createElement('tr'), who = node('td', record.chatLabel);
    who.append(node('span', record.senderLabel || '发送人未确认', 'subtext'));
    const content = node('td', record.content);
    if (records.filter(other => other.content === record.content && other.chatLabel === record.chatLabel).length > 1) content.append(node('span', '有相同正文的记录，已保留；请核对是否重复采集。', 'subtext'));
    const state = record.delivery ? labels[record.delivery.collectionStatus] : '仅本地 · 已核对';
    const stateCell = node('td', state, `state ${['failed', 'blocked'].includes(record.delivery?.collectionStatus) ? 'error' : ''}`);
    const operation = node('td', ''), send = node('button', record.delivery ? '已提交' : '提交平台', 'secondary');
    send.disabled = !!record.delivery;
    send.addEventListener('click', async () => {
      if (!confirm(`将这条已核对消息发送到 ${$('origin').value || '未填写的平台'}？\n目标群：${record.chatLabel}\n截图不会上传。`)) return;
      send.disabled = true;
      try { const delivered = await api('send', record.id, { origin: $('origin').value.trim(), token: $('token').value.trim() }); await refreshState(); status(`平台已接收：${labels[delivered.collectionStatus]}。`); }
      catch (error) { status(error.message, true); send.disabled = false; }
    });
    operation.append(send); row.append(who, content, node('td', new Date(record.reviewedAt).toLocaleString('zh-CN')), stateCell, operation); $('records').append(row);
  }
  controls();
  await window.refreshSidecar?.(data);
  window.refreshOnboarding?.(data);
}
async function showCapture(id) {
  capture = id ? await api('getCapture', id) : null;
  $('review-empty').hidden = !!capture; $('review-content').hidden = !capture;
  $('review-consent').checked = false;
  if (capture) {
    $('evidence-image').src = capture.image; $('ocr-original').value = capture.ocrText; $('message').value = '';
    $('capture-meta').textContent = `采集时间：${new Date(capture.capturedAt).toLocaleString('zh-CN')}（不是消息发送时间） · OCR 置信度 ${Math.round(capture.confidence)}%`;
    for (const id of ['chat-label', 'chat-id', 'channel-id', 'sender-label', 'sender-id', 'sent-at']) $(id).value = '';
    for (const [id, value] of [['chat-label', capture.group?.name], ['chat-id', capture.group?.chatId], ['channel-id', capture.group?.channelId]]) { $(id).value = value || ''; $(id).readOnly = !!value && !!capture.group; }
  } else { $('evidence-image').removeAttribute('src'); $('ocr-original').value = ''; $('message').value = ''; }
  controls();
}
async function stop() {
  await window.pauseCurrentCapture?.();
  await window.stopGroupMonitor?.();
  running = false; turn++; clearTimeout(timer);
  for (const track of stream?.getTracks() || []) track.stop();
  stream = null; source = null; roi = null; frozen = null; calibration = {}; previewROI = null;
  window.resetControlStatus?.();
  $('video').srcObject = null; $('video').hidden = true; $('canvas-wrap').hidden = true; $('preview-empty').hidden = false;
  $('region-label').textContent = '未选择区域'; $('capture-consent').checked = false;
  window.onPreviewDisconnected?.();
  await api('stop'); controls();
}
function draw() {
  if (!frozen) return;
  context.clearRect(0, 0, $('selection').width, $('selection').height); context.drawImage(frozen, 0, 0);
  for (const [key, area] of Object.entries({ ...calibration, ...(previewROI ? { preview: previewROI } : {}) })) { context.strokeStyle = key === 'title' ? '#15803d' : key === 'entry' ? '#b45309' : '#2563eb'; context.lineWidth = Math.max(2, frozen.width / 350); context.strokeRect(area.x, area.y, area.width, area.height); }
}
function updateRegion(value) {
  if (!frozen || !value || ![value.x,value.y,value.width,value.height].every(Number.isInteger) || value.x < 0 || value.y < 0 || value.width < 20 || value.height < 20 || value.x + value.width > frozen.width || value.y + value.height > frozen.height) throw new Error('请拖出有效矩形，或填写区域坐标；宽、高至少 20 像素，不能为 0');
  const purpose = $('roi-purpose').value; calibration[purpose] = value; previewROI = null;
  if (purpose === 'messages') roi = value;
  for (const key of ['x', 'y', 'width', 'height']) $(`roi-${key}`).value = String(value[key]);
  $('region-label').textContent = `已选${purpose === 'title' ? '标题' : purpose === 'entry' ? '群入口' : '消息'}区域 ${value.width} × ${value.height} 像素`;
  $('calibration-state').textContent = `消息：${calibration.messages ? '已选' : '未选'} · 标题：${calibration.title ? '已选' : '未选'} · 群入口：${calibration.entry ? '已选' : '未选'}`;
  status('区域已设置。请完成标题与消息区域，校验并保存会话；自动切群还需要左侧入口。');
  $('capture-consent').checked = false; draw(); controls();
  if (typeof window !== 'undefined') window.onRegionSelected?.(purpose);
}
function freeze() {
  const video = $('video');
  if (!video.videoWidth || !video.videoHeight) throw new Error('窗口画面尚未就绪');
  if (video.videoWidth * video.videoHeight > 16000000) throw new Error('画面过大，请缩小窗口');
  frozen = document.createElement('canvas'); frozen.width = video.videoWidth; frozen.height = video.videoHeight;
  frozen.getContext('2d').drawImage(video, 0, 0);
  $('selection').width = frozen.width; $('selection').height = frozen.height;
  $('canvas-wrap').hidden = false; video.hidden = true; roi = null; calibration = {}; previewROI = null; draw();
  $('calibration-state').textContent = '先框选会话名，再框选消息区；当前会话不需要左侧入口。';
  $('region-label').textContent = '画面已冻结，请拖动框选（仅用于选择区域）'; controls();
}
let pointerStart;
$('selection').addEventListener('pointerdown', event => {
  if (!frozen || running || working || window.collectorMonitorActive?.()) return;
  const rect = $('selection').getBoundingClientRect();
  pointerStart = { x: Math.round((event.clientX - rect.left) * frozen.width / rect.width), y: Math.round((event.clientY - rect.top) * frozen.height / rect.height) };
  previewROI = null;
  $('selection').setPointerCapture(event.pointerId);
});
$('selection').addEventListener('pointermove', event => {
  if (!pointerStart) return;
  const rect = $('selection').getBoundingClientRect();
  const x = Math.max(0, Math.min(frozen.width, Math.round((event.clientX - rect.left) * frozen.width / rect.width)));
  const y = Math.max(0, Math.min(frozen.height, Math.round((event.clientY - rect.top) * frozen.height / rect.height)));
  previewROI = { x: Math.min(x, pointerStart.x), y: Math.min(y, pointerStart.y), width: Math.abs(x - pointerStart.x), height: Math.abs(y - pointerStart.y) }; draw();
});
$('selection').addEventListener('pointerup', () => { if (!pointerStart) return; pointerStart = null; try { updateRegion(previewROI); } catch (error) { previewROI = null; draw(); status(error.message, true); controls(); } });
$('selection').addEventListener('pointercancel', () => { pointerStart = null; previewROI = null; draw(); controls(); });
async function begin(limit) { return window.startCurrentCapture(limit); }
action('refresh', async () => { const list = await api('sources'); $('sources').replaceChildren(new Option('请选择窗口', '')); for (const item of list) $('sources').add(new Option(item.name, item.id)); status(list.length ? '窗口列表已刷新，请只选择有权处理的聊天窗口。' : '没有可用窗口。Mac 请检查系统设置中的屏幕录制权限，并重启应用。'); });
async function connectSource(id) {
  if (!id) throw new Error('请选择目标窗口');
  await stop(); source = await api('select', id);
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: { frameRate: 2 } });
    $('video').srcObject = stream; await $('video').play(); $('video').hidden = false; $('preview-empty').hidden = true;
    for (const track of stream.getTracks()) track.addEventListener('ended', () => { stop().catch(() => {}); status('系统停止了窗口捕获，请重新选择窗口。', true); }, { once: true });
    status('仅预览已连接，尚未采集。请校验会话标题与消息区域；也可点击顶部“贴靠微信”。');
  } catch { await stop(); throw new Error('未能捕获窗口。请检查系统屏幕录制权限；权限变更后重启应用。'); }
}
action('connect', () => connectSource($('sources').value));
action('freeze', freeze);
action('apply-region', () => updateRegion(Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number($(`roi-${key}`).value)]))));
action('capture-one', () => begin(1)); action('start', () => begin());
action('stop', async () => { await stop(); status('已停止采集。已保存的本地截图和核对记录保持不变。'); });
action('import-image', async () => { working = true; controls(); status('选择截图后将在本地识别…'); try { const result = await api('importImage'); if (result) { await refreshState(); $('captures').value = result.id; await showCapture(result.id); status('截图已识别，请对照图片核对一条消息。'); } else status('已取消导入。'); } finally { working = false; } });
$('captures').addEventListener('change', () => showCapture($('captures').value).catch(error => status(error.message, true)));
for (const id of ['message', 'chat-label', 'sender-label', 'sent-at', 'channel-id', 'chat-id', 'sender-id']) $(id).addEventListener('input', () => { $('review-consent').checked = false; controls(); });
$('review-consent').addEventListener('change', controls); $('capture-consent').addEventListener('change', controls);
action('review', async () => {
  await api('review', capture.id, { content: $('message').value, chatLabel: $('chat-label').value, senderLabel: $('sender-label').value, sentAtRaw: $('sent-at').value, channelId: $('channel-id').value, chatId: $('chat-id').value, channelUserId: $('sender-id').value, confirmed: $('review-consent').checked });
  $('message').value = ''; $('sender-label').value = ''; $('sender-id').value = ''; $('sent-at').value = ''; $('review-consent').checked = false;
  await refreshState(); status('已保存为本地核对记录，尚未上传。同一截图中的其他消息请分别核对。');
});
action('export', async () => { const result = await api('export'); status(result.canceled ? '已取消导出。' : `已导出 ${result.count} 条本地记录（含同步队列）。导出文件含明文聊天，请妥善保管。`); });
action('clear', async () => { if (await api('clear')) { capture = null; await refreshState(); await showCapture(''); status('本地截图和核对记录已清空，无法恢复；平台记录未删除。'); } });
window.addEventListener('beforeunload', () => { for (const track of stream?.getTracks() || []) track.stop(); $('token').value = ''; });
(async () => { try { const info = await api('info'); $('environment').textContent = `${info.platform === 'darwin' ? 'macOS' : info.platform === 'win32' ? 'Windows' : '界面验收'} · ${info.encrypted ? '系统加密存储' : '未启用加密存储'}`; if (!info.ready) throw new Error(info.loadError); await refreshState(); } catch (error) { status(error.message, true); } controls(); })();
