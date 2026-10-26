'use strict';
// Read-only verification of the files actually shipped, not just the source tree.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const file = path.join(directory, item.name);
    return item.isDirectory() ? files(file) : [file];
  });
}
async function verify(packagePath) {
  if (!packagePath) throw new Error('请传入 .app 或 win-unpacked 的路径');
  const directory = path.resolve(packagePath), mac = directory.endsWith('.app');
  const resources = path.join(directory, mac ? 'Contents/Resources' : 'resources');
  const { extractFile } = await import('@electron/asar');
  const asar = path.join(resources, 'app.asar');
  const sources = ['desktop','src'].flatMap(name => files(path.join(root,name)));
  sources.push(path.join(root,'LICENSE'), path.join(root,'THIRD_PARTY_NOTICES.md'));
  for (const file of sources) {
    const relative = path.relative(root,file).split(path.sep).join('/');
    if (hash(fs.readFileSync(file)) !== hash(extractFile(asar,relative))) throw new Error(`包内源码不一致：${relative}`);
  }
  const sourceMetadata = require('../package.json'), metadata = JSON.parse(extractFile(asar,'package.json'));
  for (const key of ['name','version','main','dependencies']) if (JSON.stringify(sourceMetadata[key]) !== JSON.stringify(metadata[key])) throw new Error(`包内元信息不一致：${key}`);
  const expected = mac ? ['wechat-control-arm64','wechat-control-x64'] : ['wechat-control.exe','windows-build.json', ...files(path.join(root,'resources/native/licenses')).map(file => path.relative(path.join(root,'resources/native'),file))];
  const actual = files(path.join(resources,'native')).map(file => path.relative(path.join(resources,'native'),file));
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) throw new Error('包内本机组件文件清单不匹配');
  for (const file of expected) if (hash(fs.readFileSync(path.join(resources,'native',file))) !== hash(fs.readFileSync(path.join(root,'resources/native',file)))) throw new Error(`包内本机组件不一致：${file}`);
  for (const name of ['chi_sim.traineddata.gz','eng.traineddata.gz','smoke-synthetic.png']) if (hash(fs.readFileSync(path.join(resources,'ocr',name))) !== hash(fs.readFileSync(path.join(root,'resources/ocr',name)))) throw new Error(`OCR 资源不一致：${name}`);
  console.log(JSON.stringify({ package: directory, version: metadata.version, sourceFiles: sources.length, nativeFiles: actual.length, offlineOcr: true, verified: true }));
}
if (require.main === module) verify(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { verify };
