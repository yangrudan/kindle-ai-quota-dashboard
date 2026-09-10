'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const {
  clampPct,
  failedWindows,
  isoBeijing,
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

async function collectCopilot(config = {}) {
  const fetchedAt = isoBeijing();
  if (!config.enabled) {
    return { ...failedWindows('GitHub Copilot', '未启用', fetchedAt), disabled: true };
  }
  if (config.allowLocalCacheRead !== true) {
    return failedWindows('GitHub Copilot', '必须显式允许读取本机 Copilot 缓存', fetchedAt);
  }
  const cacheFile = String(config.cacheFile || path.join(os.homedir(), '.cache/copilot/copilot-user-cache.json'));
  try {
    const entry = newestCachedResponse(readCopilotCache(cacheFile));
    if (!entry) throw new Error('Copilot 缓存中没有额度数据，请先在 Copilot CLI 执行 /usage');
    const response = entry.response;
    const quota = response.quota_snapshots && response.quota_snapshots.premium_interactions;
    if (!quota) throw new Error('Copilot 缓存中没有 premium_interactions');
    const entitlement = Number(quota.entitlement);
    const remaining = Number(quota.quota_remaining != null ? quota.quota_remaining : quota.remaining);
    const remainingPct = Number(quota.percent_remaining);
    const usedPct = Number.isFinite(remainingPct)
      ? clampPct(100 - remainingPct)
      : clampPct((entitlement - remaining) / entitlement * 100);
    if (!Number.isFinite(entitlement) || entitlement <= 0 || !Number.isFinite(remaining)) {
      throw new Error('Copilot 缓存中的额度字段无效');
    }
    return {
      ok: true,
      label: 'GitHub Copilot',
      windows: [{
        name: '月度 AIC',
        usedPct,
        resetAt: response.quota_reset_date_utc ? isoBeijing(response.quota_reset_date_utc) : null,
        detailText: `剩余 ${Math.round(remaining)} / ${Math.round(entitlement)} AIC`,
      }],
      fetchedAt,
      error: null,
    };
  } catch (error) {
    return failedWindows('GitHub Copilot', error, fetchedAt);
  }
}

module.exports = { collectCopilot, newestCachedResponse, readCopilotCache };
