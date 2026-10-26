'use strict';
const { endpoint, messageBody, collectionResponse } = require('./validation.cjs');

class Uploader {
  constructor(store, fetchImpl = fetch) { this.store = store; this.fetch = fetchImpl; this.active = new Set(); }
  async send(recordId, config) {
    if (this.active.has(recordId)) throw new Error('该消息正在发送，请勿重复点击');
    const record = this.store.snapshot().records.find(row => row.id === recordId);
    if (!record) throw new Error('记录不存在');
    const url = endpoint(config.origin);
    if (record.delivery) {
      if (record.delivery.endpoint !== url) throw new Error('该消息已发送至另一平台；请勿跨平台重复投递');
      return record.delivery;
    }
    if (typeof config.token !== 'string' || config.token.length < 8 || config.token.length > 8192 || /\s/.test(config.token)) throw new Error('请填写有效租户访问令牌（不含 Bearer 前缀）');
    const body = messageBody(record);
    this.active.add(recordId);
    try {
      const response = await this.fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (response.status === 409) throw new Error('平台返回 HTTP 409：来源消息 ID 与已有内容冲突；原记录未覆盖，请核对发送人和正文，不要换 ID 强行重发');
      if (!response.ok) throw new Error(`平台返回 HTTP ${response.status}；请检查租户权限、有效期和群绑定`);
      if (!response.body) throw new Error('平台响应为空，尚未确认接收；重试将沿用原消息 ID');
      // A bounded read prevents an unexpected endpoint from exhausting local memory.
      const reader = response.body.getReader();
      let size = 0; const chunks = [];
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 65536) throw new Error('平台响应过大'); chunks.push(Buffer.from(value)); }
      } finally { await reader.cancel().catch(() => {}); }
      let raw;
      try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new Error('平台响应不是有效 JSON，尚未确认接收；重试将沿用原消息 ID'); }
      const result = collectionResponse(raw);
      const delivery = { ...result, endpoint: url, deliveredAt: new Date().toISOString() };
      await this.store.delivered(recordId, delivery);
      return delivery;
    } finally { this.active.delete(recordId); }
  }
}
module.exports = { Uploader };
