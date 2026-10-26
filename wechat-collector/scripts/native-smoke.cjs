'use strict';
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { verifyNative } = require('./native-verify.cjs');
const root = path.resolve(__dirname, '..');
try {
  verifyNative(root, process.platform);
  const component = path.join(root, 'resources/native', process.platform === 'win32' ? 'wechat-control.exe' : `wechat-control-${process.arch}`);
  // No valid window commands: these must all fail BEFORE inspecting/controlling UI.
  for (const input of ['', '{}', 'not JSON', JSON.stringify({ windowId: '123', action: 'send' }), JSON.stringify({ windowId: '-1', action: 'inspect' }), ' '.repeat(4096)]) {
    const result = spawnSync(component, [], { input, encoding: 'utf8', timeout: 8000, maxBuffer: 16384, windowsHide: true });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    const response = JSON.parse(result.stdout);
    assert.equal(response.ok, false); assert.equal(typeof response.error, 'string');
  }
  console.log('PASS: actual native helper rejected 6 invalid requests; no valid window or UI action invoked.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
