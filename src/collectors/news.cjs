'use strict';

const { isoBeijing, safeError, writeAtomic } = require('../lib/common.cjs');

const DEFAULT_FEED_URL = 'https://www.chinanews.com.cn/rss/scroll-news.xml';
const DEFAULT_SOURCE = '中国新闻网';

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function element(item, name) {
  const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function parseNewsRss(xml, limit = 5) {
  const items = [];
  const seen = new Set();
  const matches = String(xml || '').match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];
  for (const item of matches) {
    const title = element(item, 'title');
    const link = element(item, 'link');
    const published = element(item, 'pubDate');
    const timestamp = Date.parse(published);
    if (!title || !link || !Number.isFinite(timestamp) || seen.has(title)) continue;
    seen.add(title);
    items.push({
      title: title.slice(0, 52),
      url: link.slice(0, 500),
      publishedAt: isoBeijing(timestamp),
    });
  }
  items.sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  return items.slice(0, limit);
}

async function collectNews(options = {}) {
  const feedUrl = String(options.feedUrl || DEFAULT_FEED_URL);
  const response = await fetch(feedUrl, {
    headers: { 'user-agent': 'Kindle-AI-Quota-Dashboard/0.1' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`新闻源返回 HTTP ${response.status}`);
  const items = parseNewsRss(await response.text(), 5);
  if (items.length < 5) throw new Error(`新闻源只返回 ${items.length} 条有效新闻`);
  return {
    ok: true,
    source: String(options.source || DEFAULT_SOURCE).slice(0, 30),
    sourceUrl: feedUrl,
    items,
    fetchedAt: isoBeijing(),
    error: null,
  };
}

async function collectNewsToFile(filePath, options = {}) {
  try {
    const payload = await collectNews(options);
    writeAtomic(filePath, `${JSON.stringify(payload, null, 2)}\n`);
    return payload;
  } catch (error) {
    throw new Error(safeError(error));
  }
}

module.exports = {
  DEFAULT_FEED_URL,
  collectNews,
  collectNewsToFile,
  decodeXml,
  parseNewsRss,
};
