'use strict';

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

async function collectMimo(config = {}) {
  const fetchedAt = isoBeijing();
  if (!config.enabled) {
    return { ...failedBalance('Xiaomi MiMo', '未启用', fetchedAt), disabled: true };
  }
  const balanceFile = String(config.balanceFile || '').trim();
  if (!balanceFile) {
    return failedBalance('Xiaomi MiMo', 'MiMo API Key 不支持查询账户余额；需要已登录控制台数据', fetchedAt);
  }
  try {
    const balance = balanceValue(readJson(balanceFile));
    return {
      ok: true,
      label: 'Xiaomi MiMo',
      balance: round1(balance * 100) / 100,
      currency: 'CNY',
      detail: `余额 ¥${balance.toFixed(2)}`,
      fetchedAt,
      error: null,
    };
  } catch (error) {
    return failedBalance('Xiaomi MiMo', error, fetchedAt);
  }
}

module.exports = { balanceValue, collectMimo };
