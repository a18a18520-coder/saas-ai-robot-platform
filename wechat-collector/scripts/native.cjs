'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'resources/native');
async function build() {
  fs.mkdirSync(target, { recursive: true });
  const platform = process.argv.includes('--win') ? 'win32' : process.platform;
  if (platform === 'win32') {
    const { prepare, release } = require('./toolchain.cjs');
    const { createHash } = require('node:crypto');
    const compiler = await prepare();
    const output = path.join(target, 'wechat-control.exe');
    execFileSync(compiler, ['-std=c++17', '-O2', '-Wall', '-Wextra', '-Werror', '-static', '-static-libstdc++', '-static-libgcc', '-Wl,--nxcompat,--dynamicbase,--high-entropy-va,--no-insert-timestamp', path.join(root, 'native/wechat-control.cpp'), '-o', output, '-luser32', '-ldwmapi', '-ladvapi32'], { stdio: 'inherit' });
    const toolRoot = path.dirname(path.dirname(compiler)), licenses = path.join(target, 'licenses');
    fs.mkdirSync(licenses, { recursive: true });
    fs.copyFileSync(path.join(toolRoot, 'LICENSE.TXT'), path.join(licenses, 'LLVM-LICENSE.TXT'));
    const runtimeNotices = path.join(toolRoot, 'x86_64-w64-mingw32/share/mingw32');
    for (const name of fs.readdirSync(runtimeNotices).filter(name => name.startsWith('COPYING'))) fs.copyFileSync(path.join(runtimeNotices, name), path.join(licenses, name));
    const files = ['native/wechat-control.cpp', 'native/window-policy.hpp', 'scripts/native.cjs', 'scripts/toolchain.cjs'];
    const sources = Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
    const binaryHash = createHash('sha256').update(fs.readFileSync(output)).digest('hex');
    fs.writeFileSync(path.join(target, 'windows-build.json'), JSON.stringify({ protocolVersion: 1, toolchain: `llvm-mingw-${release}-ucrt`, architecture: 'x64', sources, binaryHash }, null, 2));
  } else if (platform === 'darwin') {
    const sdk = execFileSync('/usr/bin/xcrun',['--show-sdk-path'],{encoding:'utf8'}).trim();
    for (const [arch, triple] of [['arm64','arm64-apple-macosx13.0'],['x64','x86_64-apple-macosx13.0']]) {
      execFileSync('/usr/bin/xcrun',['swiftc','-O','-sdk',sdk,'-target',triple,path.join(root,'native/wechat-control.swift'),'-o',path.join(target,`wechat-control-${arch}`)],{stdio:'inherit'});
    }
    const { createHash } = require('node:crypto');
    const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    fs.writeFileSync(path.join(target, 'mac-build.json'), JSON.stringify({ protocolVersion: 1, sources: { 'native/wechat-control.swift': hash(path.join(root, 'native/wechat-control.swift')), 'scripts/native.cjs': hash(__filename) }, binaries: Object.fromEntries(['arm64', 'x64'].map(arch => [`wechat-control-${arch}`, hash(path.join(target, `wechat-control-${arch}`))])) }, null, 2));
  } else {
    throw new Error('只支持 Mac / Windows 构建');
  }
  console.log('本机窗口控制组件已准备；未执行窗口操作或申请系统权限。');
}
build().catch(error => { console.error(error.message); process.exitCode = 1; });
