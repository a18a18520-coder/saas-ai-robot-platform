'use strict';
const { groupConfig } = require('./groups.cjs');

// Reconnecting is explicit and never guesses identity from a window title alone.
async function rebindGroup({ id, confirmed, frame }, driver) {
  if (confirmed !== true) throw new Error('请先确认微信已打开所选会话');
  const group = driver.group(id), source = driver.source();
  if (!group?.titleImageHash || !source) throw new Error('请选择已保存的会话并连接微信');
  const epoch = driver.epoch();
  const next = groupConfig({ ...group, sourceId: source.id, sourceName: source.name });
  await driver.inspect(next);
  await driver.verify(next, frame);
  const valid = () => driver.epoch() === epoch && driver.source()?.id === source.id;
  if (!valid()) throw new Error('连接已改变，本次恢复已取消');
  return driver.save(next, valid);
}

function rawExport(data, groupId) {
  if (typeof groupId !== 'string' || !groupId || !data.groups.some(group => group.id === groupId)) throw new Error('请先选择要导出的会话');
  const captures = data.captures.filter(item => item.group?.id === groupId);
  if (!captures.length) throw new Error('此会话还没有采集原文');
  return { schemaVersion: 1, kind: 'unreviewed-ocr', warning: '未经人工核对的整屏 OCR，不等于单条消息；采集时间不是发送时间。', captures: captures.map(({ id, group, capturedAt, sourceName, ocrText, confidence }) => ({ id, group, capturedAt, sourceName, ocrText, confidence })) };
}
module.exports = { rebindGroup, rawExport };
