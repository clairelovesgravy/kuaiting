'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kuaiting-smoke-'));
const environment = { ...process.env, KUAITING_SMOKE_USER_DATA: directory };
delete environment.ELECTRON_RUN_AS_NODE;
try {
  const binary = process.argv[2] || require('electron');
  const args = process.argv[2] ? ['--smoke-test'] : ['.', '--smoke-test'];
  const result = spawnSync(binary, args, { cwd: path.resolve(__dirname, '..'),
    env: environment, stdio: 'inherit', timeout: 30000 });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
