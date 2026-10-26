'use strict';
// Build-only toolchain. Never downloaded or invoked by the packaged application.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const release = '20261020';
const assets = {
  darwin: { name: `llvm-mingw-${release}-ucrt-macos-universal.tar.xz`, sha256: 'e9c13e4ede38e715003ffc674d4d00a1088df8235439d1f0c16188ff0704c17e' },
  win32: { name: `llvm-mingw-${release}-ucrt-x86_64.zip`, sha256: 'fd5462b7f5d93b2ff981fcd3f9c7e427e47f3203c64ea91c27bcc444eebd74cd' }
};
async function prepare() {
  const asset = assets[process.platform];
  if (!asset) throw new Error('该构建脚本仅支持 Mac / Windows 构建机');
  const directory = path.join(root, '.runtime/toolchains');
  const folder = asset.name.replace(/\.tar\.xz$|\.zip$/u, '');
  const compiler = path.join(directory, folder, 'bin', `x86_64-w64-mingw32-clang++${process.platform === 'win32' ? '.exe' : ''}`);
  try { await fs.access(compiler); return compiler; } catch {}
  await fs.mkdir(directory, { recursive: true });
  const archive = path.join(directory, asset.name);
  let bytes;
  try { bytes = await fs.readFile(archive); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
    console.log(`下载构建工具 ${asset.name}（不进入安装包）…`);
    const response = await fetch(`https://github.com/mstorsjo/llvm-mingw/releases/download/${release}/${asset.name}`, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`构建工具下载失败：HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('构建工具 SHA-256 不匹配，未解压或执行');
    await fs.writeFile(archive, bytes);
  }
  execFileSync('tar', ['-xf', archive, '-C', directory], { stdio: 'inherit' });
  await fs.access(compiler);
  return compiler;
}
if (require.main === module) prepare().then(file => console.log(`构建工具已准备：${file}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepare, release };
