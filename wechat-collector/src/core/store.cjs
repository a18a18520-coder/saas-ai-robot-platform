'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createReviewed } = require('./validation.cjs');
const { groupConfig, groupSnapshot, titleKey } = require('./groups.cjs');

class Store {
  constructor(file, codec) { this.file = file; this.codec = codec; this.data = { version: 1, captures: [], records: [], groups: [] }; this.tail = Promise.resolve(); }
  async load() {
    let bytes;
    try { bytes = await fs.readFile(this.file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (bytes.length > 80000000) throw new Error('本地数据超过安全限制');
    const data = JSON.parse(await this.codec.decode(bytes));
    if (data.version !== 1 || !Array.isArray(data.captures) || !Array.isArray(data.records)) throw new Error('本地数据格式不兼容；请保留原文件，不要覆盖');
    if (data.groups !== undefined && !Array.isArray(data.groups)) throw new Error('本地群配置格式损坏');
    for (const field of ['syncBindings', 'syncMessages']) if (data[field] !== undefined && !Array.isArray(data[field])) throw new Error('本地同步数据格式损坏；原文件已保留');
    data.groups ??= [];
    this.data = data;
  }
  snapshot() { return structuredClone(this.data); }
  mutate(change, valid = () => true) {
    const operation = this.tail.then(async () => {
      if (!valid()) throw new Error('采集已暂停，本张结果未保存');
      const next = structuredClone(this.data);
      const result = change(next);
      if (next.captures.length > 50 || next.records.length > 500 || (next.syncMessages?.length || 0) > 500) throw new Error('本地容量已满，请先导出，再清理数据');
      const json = JSON.stringify(next);
      if (Buffer.byteLength(json) > 60000000) throw new Error('本地截图容量已满，请先导出，再清理数据');
      const encrypted = await this.codec.encode(json);
      if (!valid()) throw new Error('采集已暂停，本张结果未保存');
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      await fs.writeFile(temporary, encrypted, { mode: 0o600 });
      if (!valid()) { await fs.unlink(temporary); throw new Error('采集已暂停，本张结果未保存'); }
      await fs.rename(temporary, this.file);
      this.data = next;
      return result;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
  addCapture(capture) { return this.mutate(data => { data.captures.push(capture); return capture; }); }
  saveGroup(input, valid) { return this.mutate(data => {
    const group = groupConfig(input), old = data.groups.find(row => row.id === group.id);
    if (data.groups.some(row => row.id !== group.id && titleKey(row.name) === titleKey(group.name))) throw new Error('已存在同名或无法区分的群，请使用唯一完整群名');
    if (!old && data.groups.length >= 20) throw new Error('最多配置 20 个群');
    if (old && (old.name !== group.name || old.chatId !== group.chatId || old.channelId !== group.channelId)) throw new Error('已有群身份不能改写；请新建配置，保留旧记录归属');
    const saved = { ...group, progress: old?.progress || { historyDone: false }, calibratedAt: new Date().toISOString() };
    if (old) data.groups[data.groups.indexOf(old)] = saved; else data.groups.push(saved);
    return saved;
  }, valid); }
  groupProgress(id, progress) { return this.mutate(data => { const group = data.groups.find(row => row.id === id); if (!group) throw new Error('群配置不存在'); group.progress = { ...group.progress, historyDone: progress.historyDone === true, checkedAt: new Date().toISOString() }; }); }
  addGroupCapture(capture, id, phase, valid) { return this.mutate(data => {
    const group = data.groups.find(row => row.id === id); if (!group) throw new Error('群配置不存在');
    const previous = data.captures.filter(row => row.group?.id === id);
    // This is frame-level suppression, never message-content deduplication.
    const duplicate = phase.startsWith('history') ? previous.find(row => row.imageHash === capture.imageHash) : group.progress?.lastFrameHash === capture.imageHash;
    group.progress = { ...group.progress, lastFrameHash: capture.imageHash, checkedAt: new Date().toISOString() };
    if (duplicate) return { hash: capture.imageHash, saved: false };
    data.captures.push({ ...capture, group: groupSnapshot(group), phase });
    return { hash: capture.imageHash, saved: true, captureId: capture.id };
  }, valid); }
  review(id, input) { return this.mutate(data => { const capture = data.captures.find(row => row.id === id); const record = createReviewed(capture, input); data.records.push(record); return record; }); }
  delivered(id, delivery) { return this.mutate(data => { const record = data.records.find(row => row.id === id); if (!record) throw new Error('记录不存在'); record.delivery = delivery; }); }
  clear() { return this.mutate(data => { data.captures = []; data.records = []; data.syncMessages = []; for (const b of data.syncBindings || []) { b.lastSequence = []; b.seen = []; } for (const group of data.groups) group.progress = { historyDone: false }; }); }
}
module.exports = { Store };
