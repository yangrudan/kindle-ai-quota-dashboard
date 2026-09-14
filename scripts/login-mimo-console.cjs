'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ROOT } = require('../src/lib/config.cjs');

const profileDir = path.resolve(
  process.env.MIMO_CHROME_PROFILE || path.resolve(ROOT, '..', '.mimo-dashboard-chrome'),
);
const executable = process.env.MIMO_CHROME_PATH || '/usr/bin/google-chrome';

fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
try { fs.chmodSync(profileDir, 0o700); } catch {}

const child = spawn(executable, [
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-address=127.0.0.1',
  '--remote-debugging-port=0',
  '--remote-allow-origins=*',
  '--new-window',
  'https://platform.xiaomimimo.com/console/balance',
], {
  detached: true,
  stdio: 'ignore',
});
child.unref();
process.stdout.write(`MiMo 登录窗口已打开。登录并看到余额后先不要关闭窗口，请回来回复“好了”。\n会话目录：${profileDir}\n`);
