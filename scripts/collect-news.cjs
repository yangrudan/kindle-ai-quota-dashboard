'use strict';

const path = require('node:path');
const { collectNewsToFile, DEFAULT_FEED_URL } = require('../src/collectors/news.cjs');
const { ROOT, loadConfig } = require('../src/lib/config.cjs');

async function main() {
  const config = loadConfig();
  const news = config.news || {};
  const output = config.newsFile || path.join(ROOT, 'config', 'news.json');
  const payload = await collectNewsToFile(output, {
    feedUrl: news.feedUrl || DEFAULT_FEED_URL,
    source: news.source || '中国新闻网',
  });
  process.stdout.write(`news updated: ${payload.items.length} items from ${payload.source}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message || error}\n`);
    process.exitCode = 1;
  });
}
