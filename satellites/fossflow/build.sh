#!/bin/bash
# Build FossFLOW for /fossflow into desk/web.
# The original repo (github.com/stan-smith/FossFLOW) is gone; we build the
# maintained continuation github.com/Abrar74774/FossFLOW, which carries the
# full history (including b69fc2e, the commit the Umbrel store ships).
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
TAG=v1.0.5; COMMIT=5846189cda7013eb0f810da7eb4bdf02648fbbc7
export PATH=$HOME/.nvm/versions/node/v24.13.1/bin:$PATH   # engines: node >= 24
[ -d "$HERE/upstream/.git" ] || git clone -q https://github.com/Abrar74774/FossFLOW "$HERE/upstream"
cd "$HERE/upstream"
git checkout -q -f $COMMIT
[ "$(git rev-parse HEAD)" = $COMMIT ] || { echo "upstream is not $TAG"; exit 1; }
git apply "$HERE/patches/urbit.patch"
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build:lib >/dev/null
(cd packages/fossflow-app && rm -rf build && PUBLIC_URL=/fossflow/ npx rsbuild build >/dev/null)
W="$HERE/desk/web"; rm -rf "$W"; cp -r packages/fossflow-app/build "$W"
# the app's own worker precaches files that don't exist and caches redirects; kit's sw.js replaces it
rm -f "$W/service-worker.js" "$W/robots.txt"
find "$W" -name '*.LICENSE.txt' -o -name '*.map' | xargs rm -f
cp packages/fossflow-app/public/logo512.png "$W/icon.png"
git checkout -q -- .
python3 "$KIT/pwa.py" "$HERE/desk" --theme "#2563eb"
python3 "$KIT/claysafe.py" "$W"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
