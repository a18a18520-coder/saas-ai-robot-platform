'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publication-synthetic-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (name, content) => { const p = path.join(root, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
  put('scripts/publication-check.cjs', fs.readFileSync(path.join(__dirname, 'publication-check.cjs')));
  put('LICENSE', 'COPYRIGHT_HOLDER_TO_CONFIRM');
  for (const p of ['platform/backend', 'platform/frontend', 'wechat-collector']) {
    const pkg = { license: 'LicenseRef-Noncommercial-Commercial-Permission' };
    put(`${p}/package.json`, JSON.stringify(pkg));
    put(`${p}/package-lock.json`, JSON.stringify({ packages: { '': pkg } }));
  }
  return { root, put, run: (...args) => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts/publication-check.cjs'), ...args], { encoding: 'utf8' });
    return { status: r.status, report: JSON.parse(r.stdout), text: r.stdout };
  } };
}
test('draft can be reviewed locally; missing owner blocks public release', t => {
  const f = fixture(t); assert.equal(f.run('--draft').status, 0); assert.equal(f.run().status, 1);
  f.put('LICENSE', 'Synthetic Test Author'); assert.equal(f.run().status, 0);
});
test('environment examples allowed; real env files blocked', t => {
  const f = fixture(t); f.put('platform/backend/.env.example', 'TOKEN='); assert.equal(f.run('--draft').status, 0);
  f.put('platform/backend/.env', 'SYNTHETIC_ONLY=1'); assert.equal(f.run('--draft').status, 1);
});
test('private runtime directories blocked', t => {
  const f = fixture(t); f.put('captures/synthetic.txt', 'synthetic'); assert.equal(f.run('--draft').status, 1);
});
test('synthetic token is detected without leaking the matched value', t => {
  const f = fixture(t), secret = 'ghp_' + 'A'.repeat(36); f.put('accidental.txt', secret);
  const r = f.run('--draft'); assert.equal(r.status, 1); assert.equal(r.report.findings[0].rule, 'github-token'); assert.equal(r.text.includes(secret), false);
});
test('credential URL fixtures exempt only in exact reviewed test paths', t => {
  const f = fixture(t), url = ['https:', '//u:p@', 'example.org'].join('');
  f.put('wechat-collector/test/tenant-sync.test.cjs', url); assert.equal(f.run('--draft').status, 0);
  f.put('other-test.cjs', url); assert.equal(f.run('--draft').status, 1);
});
test('license mismatch blocks publication', t => {
  const f = fixture(t); f.put('platform/frontend/package.json', JSON.stringify({ license: 'MIT' })); assert.equal(f.run('--draft').status, 1);
});
test('unreviewed binary blocks publication', t => {
  const f = fixture(t); f.put('unknown.bin', Buffer.from([0, 1, 2])); assert.equal(f.run('--draft').status, 1);
});
test('previously tracked ignored files remain blocked', t => {
  const f = fixture(t); execFileSync('git', ['init', '--quiet'], { cwd: f.root });
  f.put('.gitignore', 'dist/\n'); f.put('dist/synthetic.txt', 'synthetic');
  execFileSync('git', ['add', '--force', 'dist/synthetic.txt'], { cwd: f.root });
  assert.equal(f.run('--draft').report.findings.some(x => x.rule === 'ignored-file-already-tracked'), true);
});
