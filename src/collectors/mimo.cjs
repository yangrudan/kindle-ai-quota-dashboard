'use strict';

const fs = require('node:fs');
const {
  failedBalance,
  isoBeijing,
  readJson,
  round1,
} = require('../lib/common.cjs');

function balanceValue(payload) {
  const source = payload && (payload.data || payload.result || payload);
  const balance = Number(source && (source.balance ?? source.totalBalance ?? source.total_balance));
  if (!Number.isFinite(balance)) throw new Error('MiMo 余额文件缺少 balance');
  return balance;
}

function balanceTimestamp(payload, filePath) {
  const source = payload && (payload.data || payload.result || payload);
  const value = source && (
    source.fetchedAt || source.fetched_at || source.updatedAt || source.updated_at
  );
  return isoBeijing(value || fs.statSync(filePath).mtime);
}

async function collectMimo(config = {}) {
  const attemptedAt = isoBeijing();
  if (!config.enabled) {
    return { ...failedBalance('Xiaomi MiMo', '未启用', attemptedAt), disabled: true };
  }
  const balanceFile = String(config.balanceFile || '').trim();
  if (!balanceFile) {
    return failedBalance('Xiaomi MiMo', 'MiMo API Key 不支持查询账户余额；需要已登录控制台数据', attemptedAt);
  }
  try {
    const payload = readJson(balanceFile);
    const balance = balanceValue(payload);
    const fetchedAt = balanceTimestamp(payload, balanceFile) || attemptedAt;
    const staleAfterMs = Math.max(1, Number(config.staleAfterMinutes || 30)) * 60 * 1000;
    const stale = Date.now() - Date.parse(fetchedAt) > staleAfterMs;
    return {
      ok: true,
      label: 'Xiaomi MiMo',
      balance: round1(balance * 100) / 100,
      currency: 'CNY',
      detail: `余额 ¥${balance.toFixed(2)}`,
      fetchedAt,
      stale,
      error: stale ? 'MiMo 控制台余额快照已过期' : null,
    };
  } catch (error) {
    return failedBalance('Xiaomi MiMo', error, attemptedAt);
  }
}

module.exports = { balanceTimestamp, balanceValue, collectMimo };
