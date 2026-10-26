'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WindowControl } = require('../src/core/window-control.cjs');
const valid = () => ({ ok: true, protocolVersion: 1, windowId: '123', trusted: true, x: -1000, y: 10, width: 1000, height: 800 });
function fake(platform = 'win32') {
  const state = { called: 0, killed: false };
  state.control = new WindowControl('/synthetic/native', { platform, execute: (command, args, options, done) => {
    Object.assign(state, { command, args, options, done, called: state.called + 1 });
    return { stdin: { on() {}, end(value) { state.request = JSON.parse(value); } }, kill() { state.killed = true; } };
  } });
  return state;
}
test('Windows invokes only bundled executable, with no shell/PowerShell/runtime flags', async () => {
  const f = fake(), pending = f.control.run('window:123:0', 'inspect');
  assert.match(f.command, /native[/\\]wechat-control\.exe$/);
  assert.deepEqual(f.args, []); assert.equal(f.options.shell, undefined);
  assert.equal(f.options.windowsHide, true); assert.equal(f.options.timeout, 8000); assert.equal(f.options.maxBuffer, 16384);
  assert.deepEqual(f.request, { windowId: '123', action: 'inspect' });
  f.done(null, JSON.stringify(valid())); assert.deepEqual(await pending, valid());
});
test('Mac bridge accepts versioned helper response without conflating inspection and trust', async () => {
  const f = fake('darwin'), pending = f.control.run('window:123:0', 'inspect'), response = { ...valid(), trusted: false };
  f.done(null, '\uFEFF' + JSON.stringify(response)); assert.equal((await pending).trusted, false);
  assert.throws(() => f.control.assertTrusted(response), /macOS/);
});
test('stop invalidates even an otherwise successful late helper response', async () => {
  const f = fake(), pending = f.control.run('window:123:0', 'inspect');
  f.control.stop(); assert.equal(f.killed, true);
  f.done(null, JSON.stringify(valid())); await assert.rejects(pending, /已取消/); assert.equal(f.control.child, null);
  const again = f.control.run('window:123:0', 'inspect'); f.done(null, JSON.stringify(valid())); assert.equal((await again).windowId, '123');
});
for (const invalid of [null, {}, { protocolVersion: 0 }, { protocolVersion: '1' }, { windowId: '124' }, { windowId: 123 }, { trusted: 'true' }, { width: 0 }, { height: 299 }, { width: 32769 }, { x: 1000001 }, { x: null }, { y: '0' }]) {
  test(`incomplete/stale helper success rejected: ${JSON.stringify(invalid)}`, async () => {
    const f = fake(), pending = f.control.run('window:123:0', 'inspect');
    const response = invalid === null || Object.keys(invalid).length === 0 ? invalid : { ...valid(), ...invalid };
    f.done(null, JSON.stringify(response)); await assert.rejects(pending); assert.equal(f.control.child, null);
  });
}
test('missing executable has actionable install error, never falls back to a script', async () => {
  const f = fake(), pending = f.control.run('window:123:0', 'inspect');
  f.done(Object.assign(new Error('private filesystem path'), { code: 'ENOENT' }), '');
  await assert.rejects(pending, /重新安装完整安装包/); assert.equal(f.called, 1);
});
test('blocked input errors are localized, with no suggestion to elevate or bypass security', async () => {
  const f = fake(), pending = f.control.run('window:123:0', 'inspect');
  f.done(new Error('exit 1'), JSON.stringify({ ok: false, error: 'input_blocked' }));
  await assert.rejects(pending, /系统未接受窗口操作/);
  assert.throws(() => f.control.assertTrusted({ trusted: false }), /勿使用提权/);
});
test('unknown native error and process stderr are not disclosed', async () => {
  const f = fake(), pending = f.control.run('window:123:0', 'inspect');
  f.done(new Error('secret'), JSON.stringify({ ok: false, error: '/private/customer/data' }));
  await assert.rejects(pending, e => /不可用/.test(e.message) && !e.message.includes('customer'));
});
test('a successful JSON response with unsuccessful exit is still a failure', async () => {
  const f = fake(), pending = f.control.run('window:123:0', 'inspect');
  f.done(new Error('timeout'), JSON.stringify(valid())); await assert.rejects(pending);
});
test('invalid IDs and unsupported platform fail before any process launch', async () => {
  const f = fake();
  for (const id of ['window:0:0', 'window:0123:0', 'window:-1:0', 'window:18446744073709551616:0', 'screen:123:0']) await assert.rejects(f.control.run(id, 'inspect'));
  const mac = fake('darwin'); await assert.rejects(mac.control.run('window:4294967296:0', 'inspect'));
  const linux = fake('linux'); await assert.rejects(linux.control.run('window:123:0', 'inspect'));
  assert.equal(f.called + mac.called + linux.called, 0);
});
test('Mac permission check needs no window and accepts only the permission response type',async()=>{
  const f=fake('darwin'),pending=f.control.permissions();assert.deepEqual(f.request,{action:'permissions'});
  f.done(null,JSON.stringify({ok:true,protocolVersion:1,kind:'permissions',trusted:false}));assert.equal((await pending).trusted,false);
  const wrong=f.control.permissions();f.done(null,JSON.stringify(valid()));await assert.rejects(wrong,/版本不兼容/);
});
test('focus is scoped to one selected window and never injects a left entry',async()=>{
  const f=fake(),pending=f.control.run('window:123:0','focus',{width:1000,height:800},{x:300,y:100,width:600,height:500});
  assert.equal(f.request.action,'focus');assert.equal(f.request.x,0.6);f.done(null,JSON.stringify(valid()));await pending;
});
