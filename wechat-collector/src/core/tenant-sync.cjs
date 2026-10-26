'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { endpoint } = require('./validation.cjs');
const key = (...parts) => JSON.stringify(parts);
const validText = (v, max = 200) => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const fingerprint = m => createHash('sha256').update(key(m.senderNickname, m.isSelf, m.content)).digest('hex');

/** Credentials never leave this main-process instance or enter the encrypted outbox. */
class TenantSync {
  constructor(store, { fetch = global.fetch, deviceName = '微信采集助手' } = {}) {
    this.store = store; this.fetch = fetch; this.deviceName = deviceName; this.session = null;
    this.epoch = 0; this.controllers = new Set(); this.active = false; this.error = ''; this.loginBusy = false;
  }
  async init() {
    await this.store.mutate(d => { d.installationId ||= randomUUID(); d.syncBindings ||= []; d.syncMessages ||= []; });
  }
  logout() { this.epoch++; this.session = null; for (const c of this.controllers) c.abort(); this.error = ''; }
  assert(s) { if (!s || this.session !== s) throw new Error('登录已变更，请重新操作'); }
  async request(origin, path, token, body, epoch = this.epoch) {
    const controller = new AbortController(); this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const r = await this.fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', credentials: 'omit',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
      if (epoch !== this.epoch) { controller.abort(); throw new Error('登录已变更，本次结果未采用'); }
      // Proxies may send HTML/empty auth errors. Stop on status, not JSON parsing.
      if ([401,403,404,409].includes(r.status)) {
        controller.abort();
        if (r.status === 401 && !token) throw new Error('租户登录失败，请检查账号、密码及租户启用状态');
        if (r.status === 401 || r.status === 403) { if (token) this.logout(); throw new Error('登录失效、设备被撤销或账号权限不足；请检查后重新登录'); }
        if (r.status === 404) throw new Error('平台尚未部署采集同步接口，或服务地址不正确');
        const e = new Error('记录归属或消息 ID 冲突，已停止重试，请核对'); e.terminal = true; throw e;
      }
      let size = 0, chunks = [];
      for await (const chunk of r.body) { size += chunk.length; if (size > 2000000) { controller.abort(); throw new Error('平台响应过大'); } chunks.push(chunk); }
      if (epoch !== this.epoch) throw new Error('登录已变更，本次结果未采用');
      const raw = JSON.parse(Buffer.concat(chunks).toString());
      if (!r.ok || (Object.hasOwn(raw, 'code') && raw.code !== 0)) {
        throw new Error(r.status === 400 ? '平台拒绝此配置或消息，请检查字段与群状态' : `平台请求未完成（${r.status}），可稍后重试`);
      }
      return Object.hasOwn(raw, 'data') ? raw.data : raw;
    } catch (e) {
      if (e.terminal || /平台|登录|记录归属/.test(e.message)) throw e;
      throw new Error('连接平台失败或超时；待同步消息仍保留在本地');
    } finally { clearTimeout(timeout); this.controllers.delete(controller); }
  }
  async login(input) {
    if (this.loginBusy) throw new Error('正在登录');
    this.logout(); this.loginBusy = true; const epoch = this.epoch;
    try {
      const origin = new URL(endpoint(input?.origin)).origin;
      if (!validText(input.account, 200) || typeof input.password !== 'string' || !input.password || input.password.length > 1024) throw new Error('请填写租户账号和密码');
      const login = await this.request(origin, '/api/v1/platform/auth/tenant/login', null, { account: input.account.trim(), password: input.password }, epoch);
      if (login.mustChangePassword) throw new Error('请先在租户网页完成初始密码修改，再登录采集助手');
      if (!validText(login.access_token, 16000)) throw new Error('平台未返回有效登录凭据');
      const token = login.access_token;
      const profile = await this.request(origin, '/api/v1/tenant/collector/profile', token, undefined, epoch);
      if (!validText(profile?.tenantId) || !validText(profile?.accountId) || !validText(profile?.account) || !validText(profile?.tenantName)) throw new Error('平台身份响应无效');
      const device = await this.request(origin, '/api/v1/tenant/collector/devices', token, { installationId: this.store.snapshot().installationId, name: this.deviceName }, epoch);
      if (!validText(device?.id) || device.tenantId !== profile.tenantId || device.accountId !== profile.accountId || device.status !== 'ACTIVE') throw new Error('平台设备归属校验失败');
      if (epoch !== this.epoch) throw new Error('登录已取消');
      this.session = { origin, token, profile, deviceId: device.id, scope: key(origin, profile.tenantId, profile.accountId, device.id) };
      await this.refresh(); return this.state();
    } finally { this.loginBusy = false; }
  }
  state() {
    const s = this.session, d = this.store.snapshot();
    return { profile: s ? { ...s.profile, origin: s.origin, deviceId: s.deviceId } : null, error: this.error, active: this.active,
      bindings: s ? (d.syncBindings || []).filter(b => b.scope === s.scope) : [],
      messages: s ? (d.syncMessages || []).filter(m => m.scope === s.scope).map(({ payload, ...m }) => ({ ...m, ...payload })) : [] };
  }
  async refresh() {
    const s = this.session; this.assert(s);
    const rows = await this.request(s.origin, `/api/v1/tenant/collector/devices/${s.deviceId}/bindings`, s.token);
    this.assert(s); if (!Array.isArray(rows)) throw new Error('会话列表格式无效');
    await this.store.mutate(d => { for (const b of d.syncBindings.filter(b => b.scope === s.scope)) {
      const remote = rows.find(r => r.id === b.bindingId && r.localGroupId === b.localGroupId && r.groupId === b.groupId);
      b.remoteEnabled = remote?.enabled === true; b.remoteName = remote?.group?.name || b.remoteName;
    } }, () => this.session === s);
    return this.state();
  }
  async groups() {
    const s = this.session; this.assert(s); const rows = await this.request(s.origin, '/api/v1/tenant/collector/groups', s.token); this.assert(s);
    if (!Array.isArray(rows)) throw new Error('平台群列表无效'); return rows;
  }
  async bind(input) {
    const s = this.session; this.assert(s);
    const group = this.store.snapshot().groups.find(g => g.id === input?.localGroupId);
    if (!group || input.confirmed !== true || typeof input.enabled !== 'boolean') throw new Error('请确认本地会话、租户目标群和同步范围');
    if (input.selfNickname && !validText(input.selfNickname, 128)) throw new Error('本人昵称无效');
    const row = await this.request(s.origin, `/api/v1/tenant/collector/devices/${s.deviceId}/bindings`, s.token, {
      localGroupId: group.id, observedName: group.name, groupId: input.groupId || undefined, createNew: input.createNew === true, enabled: input.enabled, confirmed: true });
    this.assert(s);
    if (!validText(row?.id) || row.localGroupId !== group.id || row.deviceId !== s.deviceId || row.tenantId !== s.profile.tenantId || !validText(row.groupId)) throw new Error('平台会话归属校验失败');
    await this.store.mutate(d => {
      const old = d.syncBindings.find(b => b.scope === s.scope && b.localGroupId === group.id);
      const binding = { ...old, scope: s.scope, localGroupId: group.id, bindingId: row.id, groupId: row.groupId, localName: group.name,
        enabled: input.enabled, remoteEnabled: row.enabled === true, selfNickname: input.selfNickname?.trim() || '',
        layoutConfirmed: input.layoutConfirmed === true, enabledAt: new Date().toISOString(), lastSequence: old?.lastSequence || [], seen: old?.seen || [] };
      if (old) Object.assign(old, binding); else d.syncBindings.push(binding);
    }, () => this.session === s);
    return this.refresh();
  }
  async observe(capture, groupId, observations = []) {
    const s = this.session; if (!s) return;
    const binding = this.store.snapshot().syncBindings.find(b => b.scope === s.scope && b.localGroupId === groupId && b.enabled && b.remoteEnabled);
    if (!binding || capture.capturedAt < binding.enabledAt) return;
    await this.store.mutate(d => {
      const b = d.syncBindings.find(x => x.scope === s.scope && x.localGroupId === groupId);
      const sequence = observations.map(fingerprint), previous = b.lastSequence || [];
      const unique = v => sequence.filter(x => x === v).length === 1 && previous.filter(x => x === v).length <= 1;
      const shared = sequence.filter(x => previous.includes(x) && unique(x));
      const oldShared = previous.filter(x => shared.includes(x));
      const anchored = !previous.length || (shared.length >= 2 && key(...oldShared) === key(...shared));
      const candidates = observations.length ? observations : [{ content: '', senderNickname: '', isSelf: null, reason: '未能可靠分离单条消息及发送人，请对照截图逐条核对' }];
      for (const m of candidates) {
        const fp = m.content ? fingerprint(m) : null;
        if (fp && shared.includes(fp) && anchored) continue;
        const reliable = b.layoutConfirmed && m.reliable === true && validText(m.senderNickname, 128) && typeof m.isSelf === 'boolean' && Number.isFinite(m.confidence) && m.confidence >= 96 && typeof m.content === 'string' && m.content.trim() && m.content.length <= 20000 && anchored && fp && !(b.seen || []).includes(fp) && unique(fp);
        const sourceMessageId = `collector:${randomUUID()}`;
        d.syncMessages.push({ id: sourceMessageId, scope: s.scope, localGroupId: groupId, localName: b.localName,
          captureId: capture.id, state: reliable ? 'ready' : 'pending_review', reason: reliable ? '' : m.reason || '发送人、重复消息或画面连续性需人工核对',
          payload: { sourceMessageId, bindingId: b.bindingId, senderNickname: m.senderNickname || '', isSelf: typeof m.isSelf === 'boolean' ? m.isSelf : null,
            identitySource: reliable ? 'visual_layout' : 'manual_review', content: m.content || '', capturedAt: capture.capturedAt, sentAtRaw: null,
            evidence: { imageHash: capture.imageHash, confidence: m.confidence || capture.confidence, layoutVersion: reliable ? 1 : null } } });
      }
      b.lastSequence = sequence; b.seen = [...new Set([...(b.seen || []), ...sequence])].slice(-2000);
    }, () => this.session === s);
  }
  async review(id, input) {
    const s = this.session; this.assert(s);
    if (input?.confirmed !== true || !validText(input.senderNickname, 128) || typeof input.isSelf !== 'boolean' || typeof input.content !== 'string' || !input.content.trim() || input.content.length > 20000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.content)) throw new Error('请核对单条正文、昵称和是否本人，再勾选确认');
    if (input.sentAtRaw != null && input.sentAtRaw !== '' && !validText(input.sentAtRaw, 128)) throw new Error('原始时间标记无效，请按截图填写或留空');
    await this.store.mutate(d => {
      const m = d.syncMessages.find(m => m.id === id && m.scope === s.scope && m.state === 'pending_review');
      if (!m) throw new Error('待核对消息已变化，请刷新');
      m.payload = { ...m.payload, senderNickname: input.senderNickname.trim(), isSelf: input.isSelf, content: input.content.trim(), identitySource: 'manual_review',
        sentAtRaw: validText(input.sentAtRaw, 128) ? input.sentAtRaw.trim() : null };
      m.state = 'ready'; m.reason = '';
    }, () => this.session === s); return this.state();
  }
  async discard(id) {
    const s = this.session; this.assert(s);
    await this.store.mutate(d => { const m = d.syncMessages.find(m => m.id === id && m.scope === s.scope && m.state === 'pending_review'); if (!m) throw new Error('消息不可忽略'); m.state = 'ignored'; }, () => this.session === s);
    return this.state();
  }
  async more(id) {
    const s = this.session; this.assert(s);
    await this.store.mutate(d => {
      const original = d.syncMessages.find(m => m.id === id && m.scope === s.scope);
      if (!original || !d.captures.some(c => c.id === original.captureId)) throw new Error('原始截图已不存在，不能补录');
      if (d.syncMessages.some(m => m.scope === s.scope && m.captureId === original.captureId && m.state === 'pending_review')) throw new Error('此截图还有待核对消息，请先处理');
      const sourceMessageId = `collector:${randomUUID()}`;
      d.syncMessages.push({ id: sourceMessageId, scope: s.scope, localGroupId: original.localGroupId, localName: original.localName, captureId: original.captureId,
        state: 'pending_review', reason: '同图补录：仅填写尚未同步的另一条消息', payload: { ...original.payload, sourceMessageId, content: '', senderNickname: '', isSelf: null, identitySource: 'manual_review' } });
    }, () => this.session === s); return this.state();
  }
  async flush() {
    if (this.active || !this.session) return this.state();
    const s = this.session; this.active = true; this.error = '';
    try {
      await this.refresh(); this.assert(s);
      for (const m of this.store.snapshot().syncMessages.filter(m => m.scope === s.scope && m.state === 'ready').slice(0, 20)) {
        const b = this.store.snapshot().syncBindings.find(b => b.scope === s.scope && b.bindingId === m.payload.bindingId && b.enabled && b.remoteEnabled);
        if (!b) continue;
        let receipt;
        try { receipt = await this.request(s.origin, `/api/v1/tenant/collector/devices/${s.deviceId}/messages`, s.token, m.payload); }
        catch (e) {
          if (e.terminal) await this.store.mutate(d => { const row = d.syncMessages.find(r => r.id === m.id); row.state = 'conflict'; row.reason = e.message; }, () => this.session === s);
          throw e;
        }
        this.assert(s);
        if (receipt?.sourceMessageId !== m.id || receipt.status !== 'received' || !validText(receipt.messageId)) throw new Error('平台未返回有效回执，保留原消息 ID 等待重试');
        await this.store.mutate(d => { const row = d.syncMessages.find(r => r.id === m.id); row.state = 'synced'; row.receipt = receipt; }, () => this.session === s);
      }
      const sent = this.store.snapshot().syncMessages.filter(m => m.scope === s.scope && m.state === 'synced').slice(-50);
      if (sent.length) {
        const receipts = await this.request(s.origin, `/api/v1/tenant/collector/devices/${s.deviceId}/receipts?ids=${encodeURIComponent(sent.map(m => m.id).join(','))}`, s.token);
        this.assert(s); if (!Array.isArray(receipts)) throw new Error('平台回执格式无效');
        await this.store.mutate(d => { for (const r of receipts) { const m = d.syncMessages.find(m => m.scope === s.scope && m.state === 'synced' && m.id === r.sourceMessageId); if (m && r.messageId === m.receipt.messageId && r.status === 'received') m.receipt = r; } }, () => this.session === s);
      }
    } catch (e) { if (this.session === s || !this.session) this.error = e.message; }
    finally { this.active = false; }
    return this.state();
  }
}
module.exports = { TenantSync, fingerprint };
