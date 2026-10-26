'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const hash = data => createHash('sha256').update(data).digest('hex');
function verifyNative(root, platform) {
  const native = path.join(root, 'resources/native');
  const fail = message => { throw new Error(`本机组件打包检查失败：${message}；请重新运行 npm run resources${platform === 'win32' ? ':win' : ''}`); };
  if (!['win32','darwin'].includes(platform)) fail('不支持该平台');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(native, platform === 'win32' ? 'windows-build.json' : 'mac-build.json'), 'utf8')); } catch { fail('缺少构建凭证'); }
  if (manifest.protocolVersion !== 1) fail('协议版本不匹配');
  const sources = platform === 'win32' ? ['native/wechat-control.cpp', 'native/window-policy.hpp', 'scripts/native.cjs', 'scripts/toolchain.cjs'] : ['native/wechat-control.swift', 'scripts/native.cjs'];
  for (const file of sources) {
    if (!fs.existsSync(path.join(root, file)) || manifest.sources?.[file] !== hash(fs.readFileSync(path.join(root, file)))) fail(`源码已更改：${file}`);
  }
  const names = platform === 'win32' ? ['wechat-control.exe'] : ['wechat-control-arm64', 'wechat-control-x64'];
  for (const name of names) {
    const file = path.join(native, name);
    if (!fs.existsSync(file)) fail(`缺少 ${name}`);
    const data = fs.readFileSync(file);
    if (hash(data) !== (platform === 'win32' ? manifest.binaryHash : manifest.binaries?.[name])) fail(`组件已改变：${name}`);
    if (platform === 'win32') {
      const offset = data.length >= 64 ? data.readUInt32LE(0x3c) : -1;
      if (data.toString('ascii',0,2) !== 'MZ' || offset < 64 || offset + 6 > data.length || data.readUInt32LE(offset) !== 0x4550 || data.readUInt16LE(offset + 4) !== 0x8664) fail('不是 Windows x64 PE 程序');
      for (const license of ['LLVM-LICENSE.TXT', 'COPYING', 'COPYING.MinGW-w64-runtime.txt', 'COPYING.MinGW-w64.txt', 'COPYING.winpthreads.txt', 'COPYING.winstorecompat.txt']) if (!fs.existsSync(path.join(native, 'licenses', license))) fail(`缺少第三方声明 ${license}`);
    } else {
      const cpu = name.endsWith('arm64') ? 0x100000c : 0x1000007;
      if (data.length < 8 || data.readUInt32LE(0) !== 0xfeedfacf || data.readUInt32LE(4) !== cpu) fail(`Mac 架构不匹配：${name}`);
    }
  }
  return names;
}
module.exports = async context => { verifyNative(context.packager.projectDir, context.electronPlatformName); };
module.exports.verifyNative = verifyNative;
if (require.main === module) {
  try { console.log('本机组件校验通过：', verifyNative(path.resolve(__dirname, '..'), process.argv.includes('--win') ? 'win32' : process.platform).join(', ')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
