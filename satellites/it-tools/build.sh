#!/bin/bash
# Build IT Tools (https://github.com/CorentinTh/it-tools) for /it-tools into desk/web.
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH
REPO=https://github.com/CorentinTh/it-tools
TAG=v2024.10.22-7ca5933
COMMIT=5732483fc24a6e6818839060bdf3cc7d9d324b9f

[ -d "$HERE/upstream/.git" ] || git clone --depth 1 -b "$TAG" "$REPO" "$HERE/upstream"
cd "$HERE/upstream"
[ "$(git rev-parse HEAD)" = "$COMMIT" ] || { echo "upstream is not at $COMMIT" >&2; exit 1; }
git checkout -q -f "$COMMIT" && git clean -fdq -e node_modules
# drop upstream's vite-plugin-pwa worker (kit/pwa.py installs a /it-tools/-scoped one)
git apply "$HERE/patches/urbit.patch"

npx -y pnpm@8.15.3 install --frozen-lockfile
# figlet fonts for the ASCII art tool (upstream loads them from unpkg.com)
mkdir -p public/figlet-fonts && cp node_modules/figlet/fonts/*.flf public/figlet-fonts/
# plausible stays disabled (VITE_TRACKER_ENABLED unset); base is the desk root
BASE_URL=/it-tools/ NODE_OPTIONS=--max_old_space_size=4096 npx vite build

rm -rf "$HERE/desk/web" && cp -r dist "$HERE/desk/web"
cd "$HERE/desk/web"
find . -name '*.map' -delete
cp "$HERE/upstream/public/android-chrome-512x512.png" icon.png
cd "$HERE"
python3 "$KIT/pwa.py" "$HERE/desk"
python3 "$KIT/claysafe.py" "$HERE/desk/web"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
