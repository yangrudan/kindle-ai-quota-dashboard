#!/bin/sh
BASE="/mnt/us/extensions/ai-dashboard"
URL="https://yangrudan.github.io/kindle-ai-quota-dashboard"
battery="$(lipc-get-prop com.lab126.powerd battLevel 2>/dev/null || true)"
exec "$BASE/dashboard_browser.sh" "$URL?battery=$battery"
