'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ROOT, loadConfig } = require('../src/lib/config.cjs');
const { balanceValue } = require('../src/collectors/mimo.cjs');
const { isoBeijing, writeAtomic } = require('../src/lib/common.cjs');

const CONSOLE_URL = 'https://platform.xiaomimimo.com/console/balance';
const BALANCE_PATH = '/api/v1/balance';
const DEFAULT_PROFILE = path.resolve(ROOT, '..', '.mimo-dashboard-chrome');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chromeExecutable() {
  return process.env.MIMO_CHROME_PATH || '/usr/bin/google-chrome';
}

async function waitForDebugPort(profileDir, child, startedAt) {
  const activePortFile = path.join(profileDir, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Chrome 提前退出（${child.exitCode}）`);
    try {
      const stat = fs.statSync(activePortFile);
      if (stat.mtimeMs >= startedAt - 2_000) {
        const [port] = fs.readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/);
        if (/^\d+$/.test(port)) return Number(port);
      }
    } catch {}
    await wait(250);
  }
  throw new Error('等待 Chrome 调试端口超时');
}

async function openCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let sequence = 0;

    function fail(error) {
      for (const item of pending.values()) item.reject(error);
      pending.clear();
      reject(error);
    }

    socket.addEventListener('error', () => fail(new Error('无法连接 Chrome 调试会话')));
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!message.id || !pending.has(message.id)) return;
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message || 'Chrome 调试调用失败'));
      else item.resolve(message.result);
    });
    socket.addEventListener('open', () => {
      resolve({
        socket,
        send(method, params = {}) {
          return new Promise((resolveCall, rejectCall) => {
            const id = ++sequence;
            pending.set(id, { resolve: resolveCall, reject: rejectCall });
            socket.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
              if (!pending.has(id)) return;
              pending.delete(id);
              rejectCall(new Error(`Chrome 调试调用超时：${method}`));
            }, 20_000);
          });
        },
      });
    });
  });
}

function apiPayload(value) {
  if (!value || Number(value.status) !== 200) {
    throw new Error(`MiMo 余额接口返回 HTTP ${value && value.status}`);
  }
  if (!String(value.contentType || '').includes('application/json')) {
    throw new Error('MiMo 登录已过期；请运行 npm run mimo:login 后重试');
  }
  let payload;
  try {
    payload = JSON.parse(value.text);
  } catch {
    throw new Error('MiMo 余额接口返回了无效 JSON');
  }
  balanceValue(payload);
  return payload;
}

async function readBalanceWithChrome(profileDir) {
  if (typeof WebSocket !== 'function') {
    throw new Error('MiMo 自动采集需要 Node.js 22 或更高版本');
  }
  fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(profileDir, 0o700); } catch {}

  const startedAt = Date.now();
  const child = spawn(chromeExecutable(), [
    `--user-data-dir=${profileDir}`,
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    'about:blank',
  ], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  let cdp = null;
  try {
    const port = await waitForDebugPort(profileDir, child, startedAt);
    const targetResponse = await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent(CONSOLE_URL)}`,
      { method: 'PUT' },
    );
    if (!targetResponse.ok) throw new Error(`创建 Chrome 页面失败：HTTP ${targetResponse.status}`);
    const target = await targetResponse.json();
    cdp = await openCdp(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');

    let pageUrl = '';
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const state = await cdp.send('Runtime.evaluate', {
        expression: 'document.readyState + "|" + location.href',
        returnByValue: true,
      });
      const value = state && state.result && state.result.value;
      if (typeof value === 'string') {
        const separator = value.indexOf('|');
        const readyState = value.slice(0, separator);
        pageUrl = value.slice(separator + 1);
        if (pageUrl !== 'about:blank' && readyState === 'complete') break;
      }
      await wait(250);
    }
    if (!pageUrl || pageUrl === 'about:blank') {
      throw new Error('等待 MiMo 控制台页面加载超时');
    }
    if (new URL(pageUrl).origin !== new URL(CONSOLE_URL).origin) {
      throw new Error('MiMo 登录已过期；请运行 npm run mimo:login 后重试');
    }

    const evaluated = await cdp.send('Runtime.evaluate', {
      expression: `(async function () {
        try {
          const response = await fetch('${BALANCE_PATH}', {
            credentials: 'include',
            headers: { Accept: 'application/json' }
          });
          return {
            status: response.status,
            url: response.url,
            contentType: response.headers.get('content-type') || '',
            text: (await response.text()).slice(0, 50000)
          };
        } catch (error) {
          return { clientError: String(error && error.message || error) };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (evaluated.exceptionDetails) throw new Error('MiMo 页面执行余额查询失败');
    const value = evaluated.result && evaluated.result.value;
    if (value && value.clientError) {
      throw new Error(`MiMo 余额接口请求失败：${value.clientError}`);
    }
    return apiPayload(value);
  } finally {
    if (cdp && cdp.socket.readyState < 2) cdp.socket.close();
    if (child.exitCode == null) child.kill('SIGTERM');
  }
}

async function main() {
  const config = loadConfig();
  const balanceFile = config.providers && config.providers.mimo &&
    String(config.providers.mimo.balanceFile || '').trim();
  if (!balanceFile) throw new Error('config.json 未配置 providers.mimo.balanceFile');

  const profileDir = path.resolve(process.env.MIMO_CHROME_PROFILE || DEFAULT_PROFILE);
  const payload = await readBalanceWithChrome(profileDir);
  const source = payload.data || payload.result || payload;
  const balance = balanceValue(payload);
  const currency = String(source.currency || source.currencyCode || 'CNY');
  writeAtomic(balanceFile, `${JSON.stringify({
    balance,
    currency,
    fetchedAt: isoBeijing(),
  }, null, 2)}\n`);
  process.stdout.write(`MiMo balance updated at ${isoBeijing()}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.message ? error.message : error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { apiPayload, readBalanceWithChrome };
