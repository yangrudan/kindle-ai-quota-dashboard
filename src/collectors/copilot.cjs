'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  clampPct,
  failedWindows,
  isoBeijing,
  safeError,
} = require('../lib/common.cjs');

function newestCachedResponse(cache) {
  const records = cache && (cache.copilotUserCache || cache.entries);
  const entries = records && typeof records === 'object'
    ? Object.values(records)
    : [];
  return entries
    .filter((entry) => entry && entry.response && entry.response.quota_snapshots)
    .sort((a, b) => Date.parse(b.retrievedAt || b.timestamp || 0) - Date.parse(a.retrievedAt || a.timestamp || 0))[0];
}

function readCopilotCache(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
}

function queryCopilotCloud(config = {}) {
  const envName = String(config.ghExecutableEnv || 'GH_CLI_PATH');
  const executable = String(process.env[envName] || config.ghExecutable || 'gh');
  const result = spawnSync(executable, ['api', '/copilot_internal/user'], {
    encoding: 'utf8',
    timeout: Number(config.timeoutMs || 20_000),
    maxBuffer: 2 * 1024 * 1024,
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `gh api 退出码 ${result.status}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('Copilot 云端返回了无效 JSON');
  }
}

function copilotSource(response, options = {}) {
  const quota = response && response.quota_snapshots &&
    response.quota_snapshots.premium_interactions;
  if (!quota) throw new Error('Copilot 数据中没有 premium_interactions');

  const entitlement = Number(quota.entitlement);
  const rawRemaining = Number(
    quota.quota_remaining != null ? quota.quota_remaining : quota.remaining,
  );
  const remainingPct = Number(quota.percent_remaining);
  if (!Number.isFinite(entitlement) || entitlement <= 0 || !Number.isFinite(rawRemaining)) {
    throw new Error('Copilot 额度字段无效');
  }

  const usedPct = Number.isFinite(remainingPct)
    ? clampPct(100 - remainingPct)
    : clampPct((entitlement - rawRemaining) / entitlement * 100);
  const overageUsed = Math.max(
    0,
    Number(quota.overage_count || 0),
    -rawRemaining,
  );
  const overageLimit = Number(quota.overage_entitlement);
  const detailText = overageUsed > 0
    ? `基础额度已用尽 · 超额 ${Math.ceil(overageUsed)}${Number.isFinite(overageLimit) && overageLimit > 0 ? ` / ${Math.round(overageLimit)}` : ''} AIC`
    : `剩余 ${Math.max(0, Math.round(rawRemaining))} / ${Math.round(entitlement)} AIC`;
  const observedAt = quota.timestamp_utc || options.observedAt || options.attemptedAt;

  const source = {
    ok: true,
    label: 'GitHub Copilot',
    windows: [{
      name: '月度 AIC',
      usedPct,
      resetAt: response.quota_reset_date_utc ? isoBeijing(response.quota_reset_date_utc) : null,
      detailText,
    }],
    fetchedAt: isoBeijing(observedAt) || isoBeijing(),
    error: options.error ? safeError(options.error) : null,
  };
  if (options.stale) source.stale = true;
  return source;
}

async function collectCopilot(config = {}) {
  const attemptedAt = isoBeijing();
  if (!config.enabled) {
    return { ...failedWindows('GitHub Copilot', '未启用', attemptedAt), disabled: true };
  }

  let cloudError = null;
  if (config.cloudQuery !== false) {
    try {
      return copilotSource(queryCopilotCloud(config), { attemptedAt });
    } catch (error) {
      cloudError = error;
    }
  }

  if (config.allowLocalCacheRead === true) {
    const cacheFile = String(
      config.cacheFile || path.join(os.homedir(), '.cache/copilot/copilot-user-cache.json'),
    );
    try {
      const entry = newestCachedResponse(readCopilotCache(cacheFile));
      if (!entry) throw new Error('本机 Copilot 缓存中没有额度数据');
      return copilotSource(entry.response, {
        attemptedAt,
        observedAt: entry.retrievedAt || entry.timestamp,
        stale: true,
        error: cloudError ? `云端查询失败：${safeError(cloudError)}` : '正在使用本机缓存',
      });
    } catch (cacheError) {
      const message = cloudError
        ? `云端查询失败：${safeError(cloudError)}；缓存读取失败：${safeError(cacheError)}`
        : cacheError;
      return failedWindows('GitHub Copilot', message, attemptedAt);
    }
  }

  return failedWindows(
    'GitHub Copilot',
    cloudError || '未启用云端查询，也未允许读取本机缓存',
    attemptedAt,
  );
}

module.exports = {
  collectCopilot,
  copilotSource,
  newestCachedResponse,
  queryCopilotCloud,
  readCopilotCache,
};
