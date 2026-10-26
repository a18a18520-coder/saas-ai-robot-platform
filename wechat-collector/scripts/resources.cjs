'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
async function visit(directory, callback) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('@')) await visit(full, callback);
      else { await callback(full); const nested = path.join(full, 'node_modules'); try { await visit(nested, callback); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
    }
  }
}
(async () => {
  const target = path.join(root, 'resources/ocr');
  await fs.mkdir(path.join(target, 'licenses'), { recursive: true });
  for (const lang of ['chi_sim', 'eng']) {
    const pack = require(`@tesseract.js-data/${lang}`);
    await fs.copyFile(path.join(pack.langPath, `${lang}.traineddata.gz`), path.join(target, `${lang}.traineddata.gz`));
  }
  await fs.copyFile(path.join(root, 'test/fixtures/ocr-synthetic.png'), path.join(target, 'smoke-synthetic.png'));
  const packages = [];
  await visit(path.join(root, 'node_modules'), async directory => {
    let metadata;
    try { metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')); } catch { return; }
    const id = `${metadata.name.replace(/[^a-zA-Z0-9.-]/g, '_')}-${metadata.version}`;
    const notices = (await fs.readdir(directory)).filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
    const copied = [];
    for (const name of notices) {
      if (!(await fs.stat(path.join(directory, name))).isFile()) continue;
      const filename = `${id}-${name}`;
      await fs.copyFile(path.join(directory, name), path.join(target, 'licenses', filename)); copied.push(filename);
    }
    packages.push({ name: metadata.name, version: metadata.version, license: metadata.license ?? 'See package notices', files: copied });
  });
  await fs.writeFile(path.join(target, 'licenses/index.json'), JSON.stringify(packages, null, 2));
  console.log(`Local OCR resources ready; ${packages.length} dependency notices inventoried.`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
