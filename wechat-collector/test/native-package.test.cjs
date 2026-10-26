'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { verifyNative } = require('../scripts/native-verify.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-packaging-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const native = path.join(root, 'resources/native');
  fs.mkdirSync(path.join(native, 'licenses'), { recursive: true });
  const sources = {};
  for (const file of ['native/wechat-control.cpp', 'native/window-policy.hpp', 'scripts/native.cjs', 'scripts/toolchain.cjs']) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), 'synthetic'); sources[file] = hash('synthetic'); }
  const data = Buffer.alloc(256); data.write('MZ'); data.writeUInt32LE(64, 0x3c); data.writeUInt32LE(0x4550,64); data.writeUInt16LE(0x8664,68);
  const manifest = { protocolVersion: 1, sources, binaryHash: hash(data) };
  const save = () => { fs.writeFileSync(path.join(native,'wechat-control.exe'),data); fs.writeFileSync(path.join(native,'windows-build.json'),JSON.stringify(manifest)); };
  for (const name of ['LLVM-LICENSE.TXT', 'COPYING', 'COPYING.MinGW-w64-runtime.txt', 'COPYING.MinGW-w64.txt', 'COPYING.winpthreads.txt', 'COPYING.winstorecompat.txt']) fs.writeFileSync(path.join(native,'licenses',name),'synthetic license fixture');
  save(); return { root, native, data, manifest, save };
}
test('packaging accepts matching x64 binary with all source hashes and notices', t => { const f=fixture(t); assert.deepEqual(verifyNative(f.root,'win32'),['wechat-control.exe']); });
test('missing native binary blocks packaging', t => { const f=fixture(t); fs.unlinkSync(path.join(f.native,'wechat-control.exe')); assert.throws(()=>verifyNative(f.root,'win32'),/缺少 wechat-control/); });
test('stale source blocks packaging even if executable exists', t => { const f=fixture(t); fs.appendFileSync(path.join(f.root,'native/window-policy.hpp'),'changed'); assert.throws(()=>verifyNative(f.root,'win32'),/源码已更改/); });
test('modified executable blocks packaging', t => { const f=fixture(t); fs.appendFileSync(path.join(f.native,'wechat-control.exe'),'changed'); assert.throws(()=>verifyNative(f.root,'win32'),/组件已改变/); });
test('wrong architecture blocks packaging even with a matching hash', t => { const f=fixture(t); f.data.writeUInt16LE(0x14c,68); f.manifest.binaryHash=hash(f.data); f.save(); assert.throws(()=>verifyNative(f.root,'win32'),/不是 Windows x64/); });
test('truncated PE header is rejected without out of range reads', t => { const f=fixture(t); f.data.writeUInt32LE(0xffffffff,0x3c); f.manifest.binaryHash=hash(f.data); f.save(); assert.throws(()=>verifyNative(f.root,'win32'),/不是 Windows x64/); });
test('missing native third-party notice blocks packaging', t => { const f=fixture(t); fs.unlinkSync(path.join(f.native,'licenses/LLVM-LICENSE.TXT')); assert.throws(()=>verifyNative(f.root,'win32'),/第三方声明/); });
test('Windows package excludes legacy script and compiler by explicit resource allowlist', () => {
  const pkg = require('../package.json');
  assert.deepEqual(pkg.build.win.extraResources[0].filter, ['wechat-control.exe','windows-build.json','licenses/**']);
  assert.ok(!pkg.build.files.some(file => /\.runtime|scripts|native/.test(file)));
  assert.ok(pkg.build.beforePack.endsWith('native-verify.cjs'));
});
