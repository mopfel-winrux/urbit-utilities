#!/bin/bash
# Build Super Productivity (https://github.com/johannesjo/super-productivity)
# web app for /superprod into desk/web, with WebDAV sync preconfigured to the
# ship's %utilities hub (/utilities/dav/superprod/). See NOTES.md.
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT=$(cd "$HERE/../../kit" && pwd)
TAG=v19.2.0
export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH
if [ ! -d "$HERE/upstream/.git" ]; then
  rm -rf "$HERE/upstream"
  git clone --depth 1 -b "$TAG" https://github.com/johannesjo/super-productivity "$HERE/upstream"
fi
cd "$HERE/upstream"
[ -d node_modules ] || npm ci --ignore-scripts --no-audit --no-fund
# start from the pinned tag every time (npm may touch lockfiles), then patch
git checkout -q -- . && git apply "$HERE"/patches/*.patch
# what `npm ci` would run via postinstall/prepare (minus husky)
npx patch-package >/dev/null
npx ts-patch install >/dev/null
npm run env >/dev/null
for p in sync-core sync-providers shared-schema plugin-api; do npm run "$p:build" >/dev/null; done
rm -rf dist
npm run buildFrontend:prodWeb >/dev/null
WEB="$HERE/desk/web"
rm -rf "$WEB" && cp -r dist/browser "$WEB"
find "$WEB" -name '.gitkeep' -delete
# WebDAV method-override shim, loaded before the app (see kit/CONTRACT.md)
cp "$KIT/shim.js" "$WEB/shim.js"
python3 - "$WEB/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
tag = '<script src="shim.js"></script>'
if tag not in s:
    s = s.replace('<base href="./">', '<base href="./">' + tag, 1)
    assert tag in s
open(p, 'w').write(s)
PY
cp src/assets/icons/icon-512x512.png "$WEB/icon.png"
python3 "$KIT/pwa.py" "$HERE/desk" --theme '#6495ED' --bg '#ffffff'
# index.html/manifest changed after the Angular build: regenerate the service
# worker manifest so its hashes match what is served
node_modules/.bin/ngsw-config ../desk/web ngsw-config.json >/dev/null
python3 - "$WEB/ngsw.json" <<'PY'
import json, sys
p = sys.argv[1]; m = json.load(open(p))
skip = {'/ngsw-worker.js', '/safety-worker.js', '/worker-basic.min.js'}  # as the Angular builder does
for g in m['assetGroups']:
    g['urls'] = [u for u in g['urls'] if u not in skip]
m['hashTable'] = {k: v for k, v in m['hashTable'].items() if k not in skip}
json.dump(m, open(p, 'w'), indent=2)
PY
python3 "$KIT/claysafe.py" "$WEB"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
