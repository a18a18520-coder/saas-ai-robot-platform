'use strict';
// Conservative preflight; not a substitute for independent secret/ownership review.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const draft = process.argv.includes('--draft');
const ignored = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.test-dist', '__pycache__']);
const forbiddenDirs = new Set(['.runtime', '.tmp', '.cache', 'uploads', 'captures', 'exports', 'backups', 'volumes']);
const findings = [], blockers = [];
let checked = 0;
const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ['provider-key', /\b(?:sk-[A-Za-z0-9_-]{24,}|sk-ant-[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})\b/g],
  ['jwt-literal', /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g],
  ['credential-url', /https?:\/\/[^\s/@:]+:[^\s/@]+@/g],
  ['personal-path', /(?:\/Users\/|C:\\\\Users\\\\)[A-Za-z0-9_.-]+/g],
];
function walk(dir, rel = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = rel ? `${rel}/${entry.name}` : entry.name, absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignored.has(entry.name)) continue;
      if (forbiddenDirs.has(entry.name)) { findings.push({ file: name, rule: 'private-directory' }); continue; }
      walk(absolute, name); continue;
    }
    if (entry.isSymbolicLink()) {
      if (ignored.has(entry.name)) continue; // ignored local dependency links are not published
      findings.push({ file: name, rule: 'symlink' }); continue;
    }
    if (/^\.env/.test(entry.name) && entry.name !== '.env.example' || /\.(?:pem|key|p12|pfx|enc|sqlite\d*|db|dump|backup|dmg|zip|exe|log)$/.test(entry.name)) {
      findings.push({ file: name, rule: 'private-or-built-file' }); continue;
    }
    const bytes = fs.readFileSync(absolute); checked++;
    if (bytes.includes(0)) {
      if (name !== 'wechat-collector/test/fixtures/ocr-synthetic.png') findings.push({ file: name, rule: 'unreviewed-binary' });
      continue;
    }
    const text = bytes.toString('utf8');
    if (text.includes('COPYRIGHT_HOLDER_TO_CONFIRM') && !['scripts/publication-check.cjs', 'scripts/publication-check.test.cjs'].includes(name)) blockers.push({ file: name, rule: 'copyright-owner-required' });
    for (const [rule, pattern] of rules) for (const match of text.matchAll(pattern)) {
      // Exact, reviewed negative-test fixtures; no blanket test-directory exemption.
      if (rule === 'credential-url' && (
        name === 'wechat-collector/test/core.test.cjs' && match[0] === ['https:', '//u:p@'].join('') ||
        name === 'wechat-collector/test/tenant-sync.test.cjs' && match[0] === ['https:', '//u:p@'].join('')
      )) continue;
      findings.push({ file: name, line: text.slice(0, match.index).split('\n').length, rule });
    }
  }
}
walk(root);
if (fs.existsSync(path.join(root, '.git'))) {
  const { execFileSync } = require('node:child_process');
  const trackedIgnored = execFileSync('git', ['ls-files', '-ci', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of trackedIgnored) findings.push({ file, rule: 'ignored-file-already-tracked' });
}
for (const p of ['platform/backend', 'platform/frontend', 'wechat-collector']) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, p, 'package.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(root, p, 'package-lock.json')));
  if (pkg.license !== 'LicenseRef-Noncommercial-Commercial-Permission' || lock.packages[''].license !== pkg.license) findings.push({ file: p, rule: 'license-mismatch' });
}
console.log(JSON.stringify({ checkedFiles: checked, findings, publicationBlockers: blockers, mode: draft ? 'local-draft' : 'publication', uploaded: false }, null, 2));
if (findings.length || (!draft && blockers.length)) process.exitCode = 1;
