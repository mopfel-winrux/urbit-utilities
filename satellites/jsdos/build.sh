#!/bin/bash
# Build js-dos v8 (https://github.com/caiiiycuk/js-dos) for /jsdos into desk/web.
# Downloads the pinned js-dos release (prebuilt dist incl. DOSBox and DOSBox-X wasm),
# verifies its sha256, patches out external requests, vendors the emulators and adds
# a launcher page that runs a local .jsdos bundle or .zip.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
VERSION=8.5.3
SHA256=bff63d50dbec7c6f21ababc23a2b587c32785f66b464ffe68df38e821b945c89
UP="$HERE/upstream"; WEB="$HERE/desk/web"; ZIP="$UP/js-dos-$VERSION-release.zip"
mkdir -p "$UP"
if [ ! -f "$ZIP" ]; then
  curl -fsSL -o "$ZIP.part" "https://github.com/caiiiycuk/js-dos/releases/download/v$VERSION/release.zip"
  mv "$ZIP.part" "$ZIP"
fi
echo "$SHA256  $ZIP" | sha256sum -c --quiet - || { echo "checksum mismatch: $ZIP" >&2; rm -f "$ZIP"; exit 1; }
rm -rf "$UP/release" && mkdir -p "$UP/release" && (cd "$UP/release" && unzip -q "$ZIP")
D="$UP/release/dist"
python3 "$HERE/patches/offline.py" "$D/js-dos.js"

rm -rf "$WEB" && mkdir -p "$WEB/js-dos/emulators"
cp "$D/js-dos.js" "$D/js-dos.css" "$WEB/js-dos/"
E="$D/emulators"
# runtime files only: no source maps, .symbols, debug build or typings
for f in emulators.js wlibzip.js wlibzip.wasm wdosbox.js wdosbox.wasm \
         wdosbox-x.js wdosbox-x.wasm wdosbox-x-jspi.js wdosbox-x-jspi.wasm \
         file-explorer.js file-explorer.css fileexplorer_sprites.png fileexplorer_actions.woff \
         webrtcnet.mjs webrtcnet.wasm; do
  cp "$E/$f" "$WEB/js-dos/emulators/"
done
# drop sourceMappingURL comments for maps we don't ship
sed -i '/^\/\/# sourceMappingURL=/d' "$WEB/js-dos/js-dos.js" "$WEB/js-dos/emulators/"*.js
cp "$HERE/src/index.html" "$HERE/src/launcher.js" "$HERE/src/icon.svg" "$HERE/src/license.txt" "$WEB/"

python3 "$KIT/pwa.py" "$HERE/desk" --theme "#101418" --bg "#101418"
python3 "$KIT/claysafe.py" "$WEB"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
