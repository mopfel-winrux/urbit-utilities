#!/bin/bash
# Build Squoosh (https://github.com/GoogleChromeLabs/squoosh) for /squoosh into desk/web.
# Pinned to the last commit on `dev` (what squoosh.app serves); the codec wasm
# files are prebuilt in the repo, only the rollup app build runs here.
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
COMMIT=e8d35e0fb66eb16eff6fe8fc773eabcbb7128de3
export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH
[ -d "$HERE/upstream/.git" ] || git clone -q https://github.com/GoogleChromeLabs/squoosh "$HERE/upstream"
cd "$HERE/upstream"
git checkout -q -f $COMMIT
git apply "$HERE/patches/urbit.patch"
[ -d node_modules ] || npm ci --ignore-scripts --no-audit --no-fund
npm run build >/dev/null
git checkout -q -- .
W="$HERE/desk/web"; rm -rf "$W"; cp -r build "$W"
rm -f "$W/_headers" "$W/_redirects"
# social/canonical meta tags point at squoosh.app (never fetched, but misleading here)
sed -i -E 's#<meta property="og:image[^>]*>##g; s#<link rel="canonical"[^>]*>##' "$W/index.html"
cp "$W"/c/icon-large-maskable-*.png "$W/icon.png"
python3 "$KIT/pwa.py" "$HERE/desk" --theme "#ff3385"
python3 "$KIT/claysafe.py" "$W"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
