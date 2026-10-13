#!/bin/bash
# Run satellites' test.js against a ship. usage: tools/run-tests.sh <base-url> <ship-code> <desk>...
BASE=$1; CODE=$2; shift 2
ROOT=$(cd "$(dirname "$0")/.." && pwd)
export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH
export CHROME=$HOME/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome
export NODE_PATH=$ROOT/test/node_modules
mkdir -p "$ROOT/test/logs"
for d in "$@"; do
  start=$(date +%s)
  if (cd "$ROOT/satellites/$d" && BASE_URL=$BASE SHIP_CODE=$CODE timeout 900 node test.js > "$ROOT/test/logs/$d.log" 2>&1); then r=PASS; else r=FAIL; fi
  pwa=$(cd "$ROOT" && BASE_URL=$BASE SHIP_CODE=$CODE timeout 120 node kit/pwa-check.js $d 2>&1 | tail -1 | grep -o 'errors=.*')
  echo "$r  $d  $(( $(date +%s) - start ))s  pwa:$pwa"
done
