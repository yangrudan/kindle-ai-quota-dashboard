'use strict';

const { isoBeijing, readJson, safeError } = require('./common.cjs');

function readNews(filePath) {
  if (!filePath) {
    return {
      ok: false,
      source: '新闻',
      sourceUrl: '',
      items: [],
      fetchedAt: isoBeijing(),
      error: '未配置新闻文件',
    };
  }
  try {
    const value = readJson(filePath);
    const items = Array.isArray(value.items) ? value.items.slice(0, 5).map((item) => ({
      title: String(item.title || '').slice(0, 52),
      url: String(item.url || '').slice(0, 500),
      publishedAt: isoBeijing(item.publishedAt),
    })).filter((item) => item.title && item.url && item.publishedAt) : [];
    if (items.length < 5) throw new Error('新闻文件不足 5 条有效新闻');
    return {
      ok: true,
      source: String(value.source || '新闻').slice(0, 30),
      sourceUrl: String(value.sourceUrl || '').slice(0, 500),
      items,
      fetchedAt: isoBeijing(value.fetchedAt),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      source: '新闻',
      sourceUrl: '',
      items: [],
      fetchedAt: isoBeijing(),
      error: safeError(error),
    };
  }
}

module.exports = { readNews };
