'use strict';

const {
  clampPct,
  failedWindows,
  isoBeijing,
  readJson,
} = require('../lib/common.cjs');

function usageWindow(payload) {
  const source = payload && (payload.data || payload.result || payload);
  const total = Number(source && (source.totalCredits ?? source.total ?? source.limit ?? source.entitlement));
  let used = Number(source && (source.usedCredits ?? source.used));
  const remaining = Number(source && (source.remainingCredits ?? source.remaining));
  if (!Number.isFinite(used) && Number.isFinite(total) && Number.isFinite(remaining)) used = total - remaining;
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used)) {
    throw new Error('MiMo 用量文件需包含 used/limit 或 remaining/total');
  }
  return {
    name: String(source.name || source.period || 'Token Plan'),
    usedPct: clampPct(used / total * 100),
    resetAt: source.resetAt || source.reset_at ? isoBeijing(source.resetAt || source.reset_at) : null,
    detailText: `剩余 ${Math.max(0, Math.round(total - used))} / ${Math.round(total)}`,
  };
}

async function collectMimo(config = {}) {
  const fetchedAt = isoBeijing();
  if (!config.enabled) {
    return { ...failedWindows('Xiaomi MiMo', '未启用', fetchedAt), disabled: true };
  }
  const usageFile = String(config.usageFile || '').trim();
  if (!usageFile) {
    return failedWindows('Xiaomi MiMo', '尚未配置 MiMo Token Plan 用量文件', fetchedAt);
  }
  try {
    return {
      ok: true,
      label: 'Xiaomi MiMo',
      windows: [usageWindow(readJson(usageFile))],
      fetchedAt,
      error: null,
    };
  } catch (error) {
    return failedWindows('Xiaomi MiMo', error, fetchedAt);
  }
}

module.exports = { collectMimo, usageWindow };
