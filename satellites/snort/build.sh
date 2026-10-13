#!/bin/bash
# Build Snort (https://github.com/v0l/snort) for /snort into desk/web.
# Idempotent: upstream/ is reset to the pinned tag and patches/urbit.patch is
# re-applied on every run (node_modules is kept to save time).
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
REPO=https://github.com/v0l/snort TAG=v0.5.3 COMMIT=f3a6e73e7f8dbb2357a3c770a67d7ca4fbc63da4
export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH
[ -d "$HERE/upstream/.git" ] || git clone -q --depth 1 -b $TAG $REPO "$HERE/upstream"
cd "$HERE/upstream"
[ "$(git rev-parse HEAD)" = "$COMMIT" ] || { echo "upstream is not at $COMMIT" >&2; exit 1; }
git reset -q --hard && git clean -qfdx -e node_modules
git apply "$HERE/patches/urbit.patch"
npx -y bun@1 install --frozen-lockfile >/dev/null
NODE_CONFIG_ENV=urbit npx -y bun@1 run build >/dev/null
OUT="$HERE/desk/web"
rm -rf "$OUT" && cp -r packages/app/build "$OUT"
# host-specific files that are not part of the app
rm -rf "$OUT/_headers" "$OUT/.well-known" "$OUT/nostrich_orig.jpeg"
find "$OUT" -name '*.map' -delete
cp packages/app/public/snort/nostrich_512.png "$OUT/icon.png"
python3 "$KIT/pwa.py" "$HERE/desk" --theme '#000000' --bg '#000000'
python3 "$KIT/claysafe.py" "$OUT"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
