window.DASH_DATA = {
  "updatedAt": "2026-09-21T12:10:44.718+08:00",
  "weather": {
    "ok": true,
    "description": "晴",
    "iconKey": "clear",
    "tempC": 30.6,
    "feelsLikeC": 32.7,
    "humidity": 37,
    "windKph": 5.9,
    "windDir": "北风",
    "place": "杭州",
    "observedAt": "2026-09-21T12:00:00.000+08:00",
    "fetchedAt": "2026-09-21T12:10:44.719+08:00",
    "error": null
  },
  "quote": {
    "text": "老吾老，以及人之老；幼吾幼，以及人之幼。",
    "source": "《孟子·梁惠王章句上·第八节》"
  },
  "sources": {
    "copilot": {
      "ok": true,
      "label": "GitHub Copilot",
      "windows": [
        {
          "name": "月度 AIC",
          "usedPct": 100,
          "resetAt": "2026-10-01T08:00:00.000+08:00",
          "detailText": "基础额度已用尽 · 超额 103 / 100 AIC"
        }
      ],
      "fetchedAt": "2026-09-14T10:26:38.861+08:00",
      "error": "云端查询失败：Get \"https://api.github.com/copilot_internal/user\": dial tcp 20.205.243.168:443: connect: no route to host\n",
      "stale": true
    },
    "codex": {
      "ok": true,
      "label": "Codex",
      "windows": [
        {
          "name": "5小时",
          "usedPct": 81,
          "resetAt": "2026-09-21T15:37:24.000+08:00"
        },
        {
          "name": "周",
          "usedPct": 63,
          "resetAt": "2026-09-24T10:51:48.000+08:00"
        }
      ],
      "fetchedAt": "2026-09-21T11:50:06.692+08:00",
      "error": "failed to fetch codex rate limits: error sending request for url (https://chatgpt.com/backend-api/wham/usage)",
      "stale": true,
      "lastAttemptAt": "2026-09-21T12:10:34.173+08:00"
    },
    "mimo": {
      "ok": true,
      "label": "Xiaomi MiMo",
      "balance": 28.14,
      "currency": "CNY",
      "detail": "余额 ¥28.14",
      "fetchedAt": "2026-09-21T11:50:04.939+08:00",
      "stale": false,
      "error": null
    },
    "deepseek": {
      "ok": true,
      "label": "DeepSeek",
      "balance": 24.93,
      "currency": "CNY",
      "detail": "余额 ¥24.93",
      "fetchedAt": "2026-09-21T11:50:06.702+08:00",
      "error": "fetch failed",
      "stale": true,
      "lastAttemptAt": "2026-09-21T12:10:34.181+08:00"
    }
  }
};
