#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
export npm_config_cache="$project_root/.cache/browser-check/npm"
export npm_config_update_notifier=false
export TMPDIR="$project_root/.cache/browser-check/tmp"
export PLAYWRIGHT_BROWSERS_PATH="$project_root/.cache/browser-check/browsers"
mkdir -p "$TMPDIR"
npm ci --prefix "$project_root/qa/browser" --include=dev --no-audit --no-fund
node "$project_root/qa/browser/node_modules/playwright/cli.js" install chromium firefox
