'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
  beijingDayNumber,
  demoSnapshot,
  preserveLastKnownGood,
  readQuote,
  validateSnapshot,
  writeSnapshot,
} = require('../src/collect.cjs');
const { safeError } = require('../src/lib/common.cjs');
const { ROOT, validateConfig } = require('../src/lib/config.cjs');
const { copilotSource } = require('../src/collectors/copilot.cjs');
const { collectMimo } = require('../src/collectors/mimo.cjs');
const { displayedBalance } = require('../scripts/collect-mimo-balance.cjs');
const { collectProblems } = require('../scripts/check-public.cjs');

test('demo snapshot passes the public schema', () => {
  const snapshot = demoSnapshot();
  assert.doesNotThrow(() => validateSnapshot(snapshot));
  assert.equal(snapshot.weather.place, '示例城市');
  assert.equal(snapshot.sources.deepseek.balance, 12.34);
});

test('365 local quotes rotate once per Beijing calendar day', () => {
  const filePath = path.join(ROOT, 'content', 'quotes-365.json');
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(payload.quotes.length, 365);
  assert.equal(new Set(payload.quotes.map((item) => item.text)).size, 365);
  assert.ok(payload.quotes.every((item) => item.text && item.source));

  const first = readQuote(filePath, '2026-09-11T00:01:00+08:00');
  const sameDay = readQuote(filePath, '2026-09-11T23:59:00+08:00');
  const nextDay = readQuote(filePath, '2026-09-12T00:01:00+08:00');
  const nextCycle = readQuote(filePath, '2027-09-11T00:01:00+08:00');
  assert.deepEqual(sameDay, first);
  assert.notDeepEqual(nextDay, first);
  assert.deepEqual(nextCycle, first);
  assert.equal(
    beijingDayNumber('2026-09-10T16:01:00Z'),
    beijingDayNumber('2026-09-11T00:01:00+08:00'),
  );
});

test('last known good data is preserved only for enabled failing providers', () => {
  const previous = demoSnapshot();
  const next = demoSnapshot();
  next.sources.copilot = {
    ok: false,
    label: 'GitHub Copilot',
    windows: [],
    fetchedAt: next.updatedAt,
    error: '临时失败',
  };
  next.sources.mimo = {
    ok: false,
    label: 'Xiaomi MiMo',
    windows: [],
    fetchedAt: next.updatedAt,
    error: '未启用',
    disabled: true,
  };
  preserveLastKnownGood(next, previous);
  assert.equal(next.sources.copilot.ok, true);
  assert.equal(next.sources.copilot.stale, true);
  assert.equal(next.sources.copilot.error, '临时失败');
  assert.equal(next.sources.mimo.ok, false);
  assert.equal(next.sources.mimo.disabled, true);
});

test('safeError removes obvious credential material', () => {
  const secret = 'A'.repeat(90);
  const output = safeError(`authorization: bearer ${secret}`);
  assert.doesNotMatch(output, new RegExp(secret));
  assert.match(output, /已隐藏/);
});

test('config rejects inline secrets but accepts environment variable names', () => {
  assert.doesNotThrow(() => validateConfig({
    providers: { deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
  }));
  assert.throws(() => validateConfig({
    providers: { demo: { token: 'this-should-never-be-here' } },
  }), /不允许保存密钥值/);
});

test('snapshot writer emits JSON and old-browser JavaScript', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-quota-test-'));
  try {
    writeSnapshot(demoSnapshot(), dir, false);
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
    const javascript = fs.readFileSync(path.join(dir, 'data.js'), 'utf8');
    assert.equal(json.sources.codex.ok, true);
    assert.match(javascript, /^window\.DASH_DATA = /);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('browser runtime is valid JavaScript', () => {
  for (const name of ['dashboard-runtime.js', 'app.js']) {
    const result = spawnSync(process.execPath, ['--check', path.join(ROOT, 'web', name)], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});

function runBrowserRuntime(snapshot, storage, options = {}) {
  const delays = [];
  const nodes = new Map();
  function node() {
    return {
      textContent: '',
      innerHTML: '',
      className: '',
      style: {},
      getAttribute() { return null; },
      setAttribute() {},
      querySelector() { return node(); },
      querySelectorAll() { return []; },
    };
  }
  function namedNode(name) {
    if (!nodes.has(name)) nodes.set(name, node());
    return nodes.get(name);
  }
  const head = node();
  head.appendChild = (child) => { child.parentNode = head; };
  head.removeChild = (child) => { child.parentNode = null; };
  const document = {
    createElement: () => node(),
    getElementById: (id) => namedNode(`#${id}`),
    getElementsByTagName: () => [head],
    querySelector: (selector) => namedNode(selector),
  };
  const localStorage = {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  const window = { DASH_DATA: snapshot, localStorage };
  const source = fs.readFileSync(path.join(ROOT, 'web', 'dashboard-runtime.js'), 'utf8');
  vm.runInNewContext(source, {
    window,
    document,
    Date: options.Date || Date,
    location: { search: '' },
    setTimeout: (callback, delay) => { delays.push(delay); return 1; },
  });
  return { delays, nodes, window };
}

function fixedDate(iso) {
  const instant = Date.parse(iso);
  return class FixedDate extends Date {
    constructor(value) {
      if (arguments.length) super(value);
      else super(instant);
    }

    static now() { return instant; }
  };
}

test('Kindle quiet hours wrap midnight from 23:00 to 06:00 Hangzhou time', () => {
  const night = runBrowserRuntime(demoSnapshot(), new Map(), {
    Date: fixedDate('2026-09-14T15:30:00Z'),
  });
  assert.equal(night.nodes.get('#dataStatus').textContent, '夜间省电 · 06:00恢复');
  assert.ok(night.delays.some((delay) => delay > 6 * 60 * 60 * 1000 && delay < 7 * 60 * 60 * 1000));

  const daytime = runBrowserRuntime(demoSnapshot(), new Map(), { Date: fixedDate('2026-09-14T22:30:00Z') });
  assert.notEqual(daytime.nodes.get('#dataStatus').textContent, '夜间省电 · 06:00恢复');
});

test('browser runtime restores a valid cache and rejects older replacement data', () => {
  const storage = new Map();
  const fresh = demoSnapshot();
  runBrowserRuntime(fresh, storage);
  const cacheKey = 'kindle_ai_quota_cache_v2';
  const cached = storage.get(cacheKey);
  assert.ok(cached, 'fresh data should be cached');

  const restored = runBrowserRuntime(null, storage);
  assert.equal(restored.nodes.get('#deepSeekBalance').textContent, '¥ 12.34');

  const older = demoSnapshot();
  older.updatedAt = '2025-01-01T00:00:00+08:00';
  runBrowserRuntime(older, storage);
  assert.equal(storage.get(cacheKey), cached, 'older data must not replace a newer cache');
});

test('public checker skips ignored files on Windows paths but rejects exposed data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-public-check-'));
  try {
    const initialized = spawnSync('git', ['init', '--quiet'], { cwd: dir, encoding: 'utf8' });
    assert.equal(initialized.status, 0, initialized.stderr);
    fs.writeFileSync(path.join(dir, '.gitignore'), 'config.json\nprivate/\n.env\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'config.json'), '{"providers":{}}\n', 'utf8');
    fs.mkdirSync(path.join(dir, 'private'));
    fs.writeFileSync(path.join(dir, 'private', 'config.json'), '{"private":true}\n', 'utf8');
    const localSecret = ['API', '_KEY=', '"', 'this-is-a-local-secret', '"\n'].join('');
    fs.writeFileSync(path.join(dir, '.env'), localSecret, 'utf8');
    assert.deepEqual(collectProblems(dir), []);

    fs.writeFileSync(path.join(dir, 'data.json'), '{"public":true}\n', 'utf8');
    assert.ok(
      collectProblems(dir).some((problem) => problem.includes('data.json')),
      'unignored runtime data should be rejected',
    );

    const exposedSecret = ['API', '_KEY=', '"', 'this-is-an-exposed-secret', '"\n'].join('');
    fs.writeFileSync(path.join(dir, 'credentials.txt'), exposedSecret, 'utf8');
    assert.ok(
      collectProblems(dir).some((problem) => problem.includes('credentials.txt')),
      'unignored secrets should still be rejected',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Copilot cloud quota reports overage without negative remaining credit', () => {
  const source = copilotSource({
    quota_reset_date_utc: '2026-10-01T00:00:00Z',
    quota_snapshots: {
      premium_interactions: {
        entitlement: 1500,
        quota_remaining: -40.7,
        percent_remaining: 0,
        overage_count: 40,
        overage_entitlement: 100,
        timestamp_utc: '2026-09-13T11:00:02.968Z',
      },
    },
  });
  assert.equal(source.windows[0].usedPct, 100);
  assert.match(source.windows[0].detailText, /超额 41 \/ 100 AIC/);
  assert.equal(source.fetchedAt, '2026-09-13T19:00:02.968+08:00');
});

test('MiMo snapshot exposes its real observation time and stale state', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-mimo-test-'));
  const filePath = path.join(dir, 'balance.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify({
      balance: 7.25,
      currency: 'CNY',
      fetchedAt: '2020-01-01T00:00:00+08:00',
    }));
    const source = await collectMimo({
      enabled: true,
      balanceFile: filePath,
      staleAfterMinutes: 30,
    });
    assert.equal(source.balance, 7.25);
    assert.equal(source.fetchedAt, '2020-01-01T00:00:00.000+08:00');
    assert.equal(source.stale, true);
    assert.match(source.error, /快照已过期/);

    assert.deepEqual(displayedBalance('¥ 28.39'), { balance: 28.39, currency: 'CNY' });
    assert.deepEqual(displayedBalance('$ 1,234.50'), { balance: 1234.5, currency: 'USD' });
    assert.throws(() => displayedBalance('余额加载中'), /未返回有效余额/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
