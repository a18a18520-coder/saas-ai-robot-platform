'use strict';
const { randomUUID } = require('node:crypto');
const { rectangle } = require('./validation.cjs');

function titleKey(value) {
  return String(value || '').normalize('NFKC').replace(/[\s\uFE0F\u200D]|\p{Extended_Pictographic}/gu, '').replace(/[–—−]/gu, '-');
}
function titleMatches(expected, observed) {
  const key = titleKey(expected), actual = titleKey(observed);
  return !!key && (key === actual || key === actual.replace(/\(\d{1,6}\)$/, ''));
}
function assertTitleMatch(expected, result) {
  if (Number.isFinite(result?.confidence) && result.confidence >= 65 && titleMatches(expected, result.ocrText)) return;
  const display = value => String(value || '').replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 220) || '未识别到文字';
  const confidence = Number.isFinite(result?.confidence) ? `${Math.round(result.confidence)}%` : '未知';
  throw new Error(`群名不匹配或识别不清，未保存消息。预期：${display(expected)}；识别：${display(result?.ocrText)}（置信度 ${confidence}）。请核对完整群名，并重新框选标题；不要将错误识别文字当作群名。`);
}
function field(value, name, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/u.test(value)) throw new Error(`${name}无效`);
  return value.trim();
}
function groupConfig(input) {
  if (!input || typeof input !== 'object') throw new Error('请配置目标群');
  const name = field(input.name, '完整群名');
  if (titleKey(name).length < 3 || /[.…]{2,}/u.test(name)) throw new Error('请填写至少三个字且未截断的完整群名');
  const sourceId = field(input.sourceId, '窗口标识');
  if (!/^window:\d+:\d+$/.test(sourceId)) throw new Error('仅允许已选择的单个窗口');
  const { width, height } = input.geometry || {};
  const regions = Object.fromEntries(['title', 'messages'].map(key => [key, rectangle(input.regions?.[key], width, height)]));
  if (input.regions?.entry) regions.entry = rectangle(input.regions.entry, width, height);
  const { entry, title, messages } = regions;
  if ((entry && entry.x + entry.width > messages.x) || title.y + title.height > messages.y) throw new Error('群入口须在消息区域左侧，群标题须在消息区域上方');
  if (entry && entry.x + entry.width > width * 0.5) throw new Error('群入口只能位于微信左侧会话列表');
  const historyScreens = Number(input.historyScreens), intervalSeconds = Number(input.intervalSeconds);
  if (!Number.isInteger(historyScreens) || historyScreens < 0 || historyScreens > 30) throw new Error('历史屏数须为 0–30 的整数');
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 10 || intervalSeconds > 3600) throw new Error('检查间隔须为 10–3600 秒整数');
  const optional = (value, label) => value === '' || value == null ? null : field(value, label);
  const nativeSize = input.nativeSize && Number.isFinite(input.nativeSize.width) && Number.isFinite(input.nativeSize.height) && input.nativeSize.width > 300 && input.nativeSize.height > 300 ? { width: input.nativeSize.width, height: input.nativeSize.height } : null;
  const titleImageHash = /^[a-f0-9]{64}$/.test(input.titleImageHash || '') ? input.titleImageHash : null;
  return { id: input.id ? field(input.id, '配置 ID', 128) : randomUUID(), name, sourceId, nativeSize, titleImageHash,
    sourceName: field(input.sourceName, '窗口名称', 512), geometry: { width, height }, regions,
    historyScreens, intervalSeconds, chatId: optional(input.chatId, '平台群 ID'), channelId: optional(input.channelId, '采集账号 ID'), enabled: true };
}
function groupSnapshot(group) {
  return { id: group.id, name: group.name, chatId: group.chatId, channelId: group.channelId };
}
module.exports = { groupConfig, groupSnapshot, titleKey, titleMatches, assertTitleMatch };
