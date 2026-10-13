#!/bin/bash
# Build miniPaint (https://github.com/viliusle/miniPaint) for /minipaint into desk/web.
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
TAG=v4.14.3; COMMIT=a79733eb803fc97084ef0ee4faa96b031e69e1c0
export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH
[ -d "$HERE/upstream/.git" ] || git clone -q --depth 1 -b $TAG https://github.com/viliusle/miniPaint "$HERE/upstream"
cd "$HERE/upstream"
[ "$(git rev-parse HEAD)" = $COMMIT ] || { echo "upstream is not $TAG ($COMMIT)"; exit 1; }
git checkout -q -- . && git apply "$HERE/patches/urbit.patch"
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build >/dev/null
W="$HERE/desk/web"; rm -rf "$W"; mkdir -p "$W/dist" "$W/src/js/libs/gifjs"
cp dist/bundle.js "$W/dist/"
# commented-out manifest link (kit/pwa.py would pick it up) and social meta tags
sed -e '/<!-- <link rel="manifest"/d' -e '/https:\/\/viliusle.github.io/d' index.html > "$W/index.html"
cp -r images "$W/images"; rm -f "$W/images/preview.gif" "$W/images/preview.jpg"
grep -v sourceMappingURL src/js/libs/gifjs/gif.worker.js > "$W/src/js/libs/gifjs/gif.worker.js"
cp images/favicon.svg "$W/icon.svg"
git checkout -q -- dist
python3 "$KIT/pwa.py" "$HERE/desk" --theme "#2f3542" --bg "#2f3542"
python3 "$KIT/claysafe.py" "$W"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
