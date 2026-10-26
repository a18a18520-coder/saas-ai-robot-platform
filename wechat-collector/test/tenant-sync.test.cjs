'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TenantSync } = require('../src/core/tenant-sync.cjs');
const { extractMessages } = require('../src/core/message-layout.cjs');
function fixture() {
  let data = { groups: [{ id: 'local-a', name: '合成甲群' }, { id: 'local-b', name: '合成乙群' }], captures: [], records: [] }, calls = [], remoteBindings = [], receipts = [], httpError = 0;
  const store = { snapshot: () => structuredClone(data), mutate: async (f, valid = () => true) => { if (!valid()) throw Error('stale'); const d = structuredClone(data); const r = f(d); data = d; return r; } };
  const fetch = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : undefined; calls.push({ url, body, headers: options.headers });
    const token = options.headers.Authorization, accountId = token?.endsWith('token-b') ? 'operator-b' : 'operator-a', tenantId = accountId === 'operator-a' ? 'tenant-a' : 'tenant-b';
    let value;
    if (url.endsWith('/tenant/login')) value = { access_token: body.account === 'b' ? 'token-b' : 'token-a' };
    else if (url.endsWith('/profile')) value = { tenantId, tenantName: tenantId, accountId, account: accountId };
    else if (url.endsWith('/devices')) value = { id: accountId + '-device', tenantId, accountId, status: 'ACTIVE' };
    else if (url.endsWith('/groups')) value = [];
    else if (url.endsWith('/bindings')) {
      if (body) { value = { id: 'binding-' + body.localGroupId, groupId: 'remote-' + body.localGroupId, deviceId: accountId + '-device', tenantId, ...body }; remoteBindings = remoteBindings.filter(x => x.id !== value.id).concat(value); }
      else value = remoteBindings;
    } else if (url.endsWith('/messages')) {
      if (httpError) return new Response(JSON.stringify({ message: 'SECRET RAW SERVER ERROR' }), { status: httpError });
      value = { status: 'received', sourceMessageId: body.sourceMessageId, messageId: 'received-' + body.sourceMessageId, processingStatus: 'collected' }; receipts.push(value);
    } else if (url.includes('/receipts?')) value = receipts;
    else throw Error('unexpected URL');
    return new Response(JSON.stringify({ code: 0, data: value }));
  };
  const sync = new TenantSync(store, { fetch });
  return { sync, store, calls, setError: n => { httpError = n; }, remoteOff: () => { remoteBindings.forEach(b => b.enabled = false); } };
}
async function login(f, account = 'a') { await f.sync.init(); await f.sync.login({ origin: 'http://127.0.0.1:3001', account, password: 'fixture-secret' }); }
async function bind(f, id = 'local-a', extra = {}) { await f.sync.bind({ localGroupId: id, createNew: true, enabled: true, confirmed: true, layoutConfirmed: true, selfNickname: '合成本人', ...extra }); }
const capture = id => ({ id, capturedAt: new Date(Date.now() + 20).toISOString(), imageHash: 'a'.repeat(64), confidence: 98 });
const message = (content = '金额：1.2万元', extra = {}) => ({ content, senderNickname: '示例甲', isSelf: false, confidence: 98, reliable: true, ...extra });
test('login uses server identity; credentials never enter store or renderer state', async () => {
  const f = fixture(); await login(f); assert.equal(f.sync.state().profile.tenantId, 'tenant-a');
  for (const value of [f.store.snapshot(), f.sync.state()]) assert.doesNotMatch(JSON.stringify(value), /fixture-secret|token-a|Authorization/);
});
test('non-loopback HTTP and URL credentials are rejected before network', async () => {
  for (const origin of ['http://example.org', 'https://u:p@example.org', 'https://example.org/path']) {
    const f = fixture(); await f.sync.init(); await assert.rejects(f.sync.login({ origin, account: 'a', password: 'x' })); assert.equal(f.calls.length, 0);
  }
});
test('unbound and pre-opt-in captures do not create an upload queue', async () => {
  const f = fixture(); await login(f); await f.sync.observe(capture('before'), 'local-a', [message()]); assert.equal(f.sync.state().messages.length, 0);
  await bind(f); await f.sync.observe({ ...capture('old'), capturedAt: '2020-01-01T00:00:00Z' }, 'local-a', [message()]); assert.equal(f.sync.state().messages.length, 0);
});
test('reliable message auto syncs with nickname, explicit self flag and immutable source ID', async () => {
  const f = fixture(); await login(f); await bind(f); await f.sync.observe(capture('c1'), 'local-a', [message()]);
  const id = f.sync.state().messages[0].id; await f.sync.flush(); await f.sync.flush();
  const posts = f.calls.filter(c => c.url.endsWith('/messages')); assert.equal(posts.length, 1); assert.equal(posts[0].body.sourceMessageId, id);
  assert.equal(posts[0].body.isSelf, false); assert.equal(posts[0].body.senderNickname, '示例甲'); assert.equal(f.sync.state().messages[0].state, 'synced');
});
test('unknown layout is pending and never transmitted', async () => {
  const f = fixture(); await login(f); await bind(f); await f.sync.observe(capture('c1'), 'local-a', []); await f.sync.flush();
  assert.equal(f.sync.state().messages[0].state, 'pending_review'); assert.equal(f.calls.filter(c => c.url.endsWith('/messages')).length, 0);
});
test('layout opt-in is required even if parser reports confidence', async () => {
  const f = fixture(); await login(f); await bind(f, 'local-a', { layoutConfirmed: false }); await f.sync.observe(capture('c1'), 'local-a', [message()]); assert.equal(f.sync.state().messages[0].state, 'pending_review');
});
test('manual review requires nickname, self choice, body and consent; keeps source ID', async () => {
  const f = fixture(); await login(f); await bind(f); await f.sync.observe(capture('c1'), 'local-a'); const m = f.sync.state().messages[0];
  const valid = { senderNickname: '我在微信的昵称', isSelf: true, content: '进度：完成', confirmed: true };
  for (const patch of [{ confirmed: false }, { isSelf: null }, { senderNickname: '' }, { content: '' }]) await assert.rejects(f.sync.review(m.id, { ...valid, ...patch }));
  await f.sync.review(m.id, valid); await f.sync.flush(); const result = f.sync.state().messages[0]; assert.equal(result.id, m.id); assert.equal(result.isSelf, true); assert.equal(result.identitySource, 'manual_review');
});
test('same text in independent groups has distinct source IDs and bindings', async () => {
  const f = fixture(); await login(f); await bind(f); await bind(f, 'local-b'); await f.sync.observe(capture('c1'), 'local-a', [message()]); await f.sync.observe(capture('c2'), 'local-b', [message()]);
  const [a,b] = f.sync.state().messages; assert.notEqual(a.id, b.id); assert.notEqual(a.bindingId, b.bindingId); assert.ok([a,b].every(m => m.state === 'ready'));
});
test('ambiguous repeats remain pending instead of auto uploading', async () => {
  const f = fixture(); await login(f); await bind(f); await f.sync.observe(capture('c1'), 'local-a', [message(), message()]); assert.ok(f.sync.state().messages.every(m => m.state === 'pending_review'));
});
test('network retry reuses source ID; conflict is terminal', async () => {
  const f = fixture(); await login(f); await bind(f); await f.sync.observe(capture('c1'), 'local-a', [message()]); f.setError(500); await f.sync.flush();
  assert.equal(f.sync.state().messages[0].state, 'ready'); assert.doesNotMatch(f.sync.state().error, /SECRET/);
  f.setError(409); await f.sync.flush(); await f.sync.flush(); const posts = f.calls.filter(c => c.url.endsWith('/messages')); assert.equal(posts.length, 2); assert.equal(posts[0].body.sourceMessageId, posts[1].body.sourceMessageId); assert.equal(f.sync.state().messages[0].state, 'conflict');
});
test('logout, account change and remote disable cannot upload previous pending records', async () => {
  const f = fixture(); await login(f); await bind(f); await f.sync.observe(capture('c1'), 'local-a', [message()]); f.sync.logout(); await f.sync.flush();
  assert.equal(f.sync.state().messages.length, 0); await login(f, 'b'); await f.sync.flush(); assert.equal(f.sync.state().messages.length, 0);
  await login(f); f.remoteOff(); await f.sync.flush(); assert.equal(f.calls.filter(c => c.url.endsWith('/messages')).length, 0);
});
test('late login response cannot restore a logged-out session', async () => {
  const f = fixture(); await f.sync.init(); let release; const original = f.sync.fetch;
  f.sync.fetch = async (...args) => { await new Promise(r => { release = r; }); return original(...args); };
  const p = f.sync.login({ origin: 'http://localhost:3001', account: 'a', password: 'fixture-secret' }); f.sync.logout(); release(); await assert.rejects(p); assert.equal(f.sync.state().profile, null);
});
test('403 stops session and leaves outbox intact', async () => {
  const f = fixture(); await login(f); await bind(f); await f.sync.observe(capture('c1'), 'local-a', [message()]); f.setError(403); await f.sync.flush(); assert.equal(f.sync.state().profile, null); assert.equal(f.store.snapshot().syncMessages[0].state, 'ready');
});
test('non-JSON auth and conflict errors are still terminal', async () => {
  for (const status of [401,403,409]) {
    const f=fixture(); await login(f); await bind(f); await f.sync.observe(capture('c1'),'local-a',[message()]);
    const original=f.sync.fetch; f.sync.fetch=(url,opts)=>url.endsWith('/messages')?Promise.resolve(new Response('<html>private upstream error</html>',{status})):original(url,opts);
    await f.sync.flush(); assert.doesNotMatch(f.sync.state().error,/private/);
    if(status===409)assert.equal(f.sync.state().messages[0].state,'conflict');else assert.equal(f.sync.state().profile,null);
  }
});
function layout(self = false, conf = 99) {
  const width = 600, height = 300, bitmap = Buffer.alloc(width * height * 4);
  for (let i=0;i<bitmap.length;i+=4) { bitmap[i]=bitmap[i+1]=bitmap[i+2]=237; bitmap[i+3]=255; }
  const x = self ? 340 : 60;
  for (let y=80;y<124;y++) for (let xx=x;xx<x+200;xx++) { const i=(y*width+xx)*4; bitmap[i]=self?149:255;bitmap[i+1]=self?235:255;bitmap[i+2]=self?128:255; }
  const lines = [{ text: '示例甲', confidence: conf, bbox: { x0: x, y0: 50, x1: x+60, y1: 70 } }, { text: '合成正文', confidence: conf, bbox: { x0:x+12,y0:92,x1:x+132,y1:114 } }];
  return { bitmap,width,height,lines,selfNickname:'合成本人' };
}
test('synthetic white bubble associates only the nickname directly above it', () => {
  const rows = extractMessages(layout()); assert.equal(rows.length,1); assert.equal(rows[0].senderNickname,'示例甲'); assert.equal(rows[0].isSelf,false); assert.equal(rows[0].reliable,true);
});
test('synthetic right green bubble is self only with configured WeChat nickname', () => {
  const row = extractMessages(layout(true))[0]; assert.equal(row.senderNickname,'合成本人'); assert.equal(row.isSelf,true); assert.equal(row.reliable,true);
  assert.equal(extractMessages({...layout(true),selfNickname:''})[0].reliable,false);
});
test('low confidence, missing nickname and quoted cards are never reliable', () => {
  assert.equal(extractMessages(layout(false,80))[0].reliable,false);
  const noName=layout();noName.lines.shift();assert.equal(extractMessages(noName)[0].reliable,false);
  const card=layout();card.lines[1].text='[图片]';assert.equal(extractMessages(card)[0].reliable,false);
});
test('unknown pixel format/size and absent geometry fail closed', () => {
  assert.deepEqual(extractMessages({...layout(),bitmap:Buffer.alloc(1)}),[]); assert.deepEqual(extractMessages({...layout(),lines:undefined}),[]);
});
test('a nickname touching the capture edge cannot certify a sender', () => {
  const image=layout();image.lines[0].bbox.y0=0;
  assert.equal(extractMessages(image)[0].reliable,false);
});
