'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
async function run() {
  const root = path.resolve(__dirname, '..');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'collector-native-policy-'));
  try {
    const windows = process.platform === 'win32';
    const compiler = windows ? await require('./toolchain.cjs').prepare() : '/usr/bin/clang++';
    const executable = path.join(directory, windows ? 'policy-test.exe' : 'policy-test');
    const flags = windows ? ['-static'] : ['-fsanitize=address,undefined', '-fno-omit-frame-pointer'];
    execFileSync(compiler, ['-std=c++17', '-O1', '-Wall', '-Wextra', '-Werror', ...flags, path.join(root, 'test/window-policy.cpp'), '-o', executable], { stdio: 'inherit', timeout: 60000 });
    execFileSync(executable, [], { stdio: 'inherit', timeout: 30000 });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
