'use strict';
const { randomUUID, createHash } = require('node:crypto');
const MAX_TEXT = 20000;
const STATES = new Set(['processing', 'collected', 'needs_review', 'ignored', 'failed', 'blocked']);

function text(value, name, max = MAX_TEXT, optional = false) {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    throw new Error(`${name}不能为空、过长或包含控制字符`);
  }
  return value.trim();
}

function captureConfig(value) {
  const intervalSeconds = Number(value.intervalSeconds);
  const maxCaptures = Number(value.maxCaptures);
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 2 || intervalSeconds > 3600) throw new Error('采集间隔须为 2–3600 秒整数');
  if (!Number.isInteger(maxCaptures) || maxCaptures < 1 || maxCaptures > 50) throw new Error('本轮采集次数须为 1–50 次');
  return { intervalSeconds, maxCaptures };
}

function rectangle(value, width, height) {
  if (!value || ![width, height, value.x, value.y, value.width, value.height].every(Number.isInteger)) throw new Error('请重新框选聊天区域');
  if (width < 1 || height < 1 || width * height > 16000000 || value.x < 0 || value.y < 0 || value.width < 20 || value.height < 20 || value.x + value.width > width || value.y + value.height > height) throw new Error('聊天区域超出画面或过小');
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function pngBytes(dataURL) {
  if (typeof dataURL !== 'string' || dataURL.length > 12000000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(dataURL)) throw new Error('只接受不超过 9 MB 的 PNG 截图');
  const bytes = Buffer.from(dataURL.slice(22), 'base64');
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('截图不是有效 PNG');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16000000) throw new Error('截图像素数量超出限制');
  return bytes;
}

function createCapture({ dataURL, ocrText, confidence, sourceName, lines, capturedAt = new Date().toISOString() }) {
  const bytes = pngBytes(dataURL);
  if (typeof ocrText !== 'string' || ocrText.length > MAX_TEXT) throw new Error('识别文字过长，请缩小采集区域');
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) throw new Error('识别置信度无效');
  return { id: randomUUID(), capturedAt, sourceName: text(sourceName, '窗口名称', 512), imageHash: createHash('sha256').update(bytes).digest('hex'), image: dataURL, ocrText, confidence, ...(Array.isArray(lines) ? { lines: lines.slice(0,500) } : {}), status: 'unreviewed' };
}

function createReviewed(capture, input) {
  if (!capture || input.confirmed !== true) throw new Error('请对照截图核对单条消息、发送人及目标群，并勾选确认');
  const content = text(input.content, '单条消息正文');
  const sentAtRaw = text(input.sentAtRaw, '原始时间标记', 128, true);
  if (capture.group && (input.chatLabel !== capture.group.name || (capture.group.chatId && input.chatId !== capture.group.chatId) || (capture.group.channelId && input.channelId !== capture.group.channelId))) throw new Error('轮巡截图的群归属不能改写，请核对当前群绑定');
  return {
    id: randomUUID(), sourceMessageId: `local:${randomUUID()}`, captureId: capture.id,
    capturedAt: capture.capturedAt, reviewedAt: new Date().toISOString(),
    sourceName: capture.sourceName, imageHash: capture.imageHash,
    ...(capture.group ? { group: structuredClone(capture.group) } : {}),
    ocrOriginal: capture.ocrText, content, humanCorrected: !capture.ocrText.includes(content),
    senderLabel: text(input.senderLabel, '发送人显示名称', 128, true),
    channelUserId: text(input.channelUserId, '发送人绑定 ID', 200, true),
    chatLabel: text(input.chatLabel, '群名称', 200),
    chatId: text(input.chatId, '平台群绑定 ID', 200, true),
    channelId: text(input.channelId, '采集账号绑定 ID', 200, true),
    sentAtRaw, sentAt: null, timeSource: sentAtRaw ? 'visible_label_unresolved' : 'unknown',
    status: 'reviewed', delivery: null
  };
}

function messageBody(record) {
  if (record.status !== 'reviewed') throw new Error('只有已核对消息可发送至平台');
  return { channel: 'wechat', channelId: text(record.channelId, '采集账号绑定 ID', 200), chatId: text(record.chatId, '平台群绑定 ID', 200), channelUserId: text(record.channelUserId, '发送人绑定 ID', 200), sourceMessageId: text(record.sourceMessageId, '消息 ID', 200), content: text(record.content, '消息正文'), isAtRobot: false };
}

function endpoint(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('平台地址只填写协议和主机端口，不要填写路径、凭据或参数');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('平台地址须为 HTTPS；仅本机可使用 HTTP');
  return `${url.origin}/api/v1/tenant/messages`;
}

function collectionResponse(raw) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(raw) || (Object.hasOwn(raw, 'code') && raw.code !== 0)) throw new Error('平台未返回成功响应；尚未确认收集记录');
  const value = Object.hasOwn(raw, 'data') ? raw.data : raw;
  if (!object(value)) throw new Error('平台收集响应格式无效');
  if (!value || typeof value.collectionId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.collectionId) || !STATES.has(value.collectionStatus)) throw new Error('平台未返回有效的收集记录，请确认群绑定到已发布的信息收集机器人');
  return { collectionId: value.collectionId, collectionStatus: value.collectionStatus };
}

module.exports = { captureConfig, rectangle, pngBytes, createCapture, createReviewed, messageBody, endpoint, collectionResponse };
