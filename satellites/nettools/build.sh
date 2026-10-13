#!/bin/bash
# Build Networking Toolbox (https://github.com/Lissy93/networking-toolbox) as a
# static site for /nettools into desk/web. Server-side tools (the "Lookups" /
# diagnostics section and the MAC vendor lookup) are hidden; see NOTES.md.
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH
REPO=https://github.com/Lissy93/networking-toolbox
TAG=v1.6.0
COMMIT=8ea4470becca9d197705a6e59a425d9c0370aceb

[ -d "$HERE/upstream/.git" ] || git clone --depth 1 -b "$TAG" "$REPO" "$HERE/upstream"
cd "$HERE/upstream"
[ "$(git rev-parse HEAD)" = "$COMMIT" ] || { echo "upstream is not at $COMMIT" >&2; exit 1; }
git checkout -q -f "$COMMIT" && git clean -fdq -e node_modules
git apply "$HERE/patches/urbit.patch"

[ -d node_modules ] || npm ci --no-audit --no-fund
DEPLOY_ENV=static BASE_URL=/nettools npx vite build

rm -rf "$HERE/desk/web" && cp -r build "$HERE/desk/web"
cd "$HERE/desk/web"
find . -name '*.map' -delete
# upstream's root-scoped worker (kit/pwa.py installs a /nettools/ one), the
# CDN-based swagger page for the (absent) API, and SEO files
rm -rf sw.js api-docs.html robots.txt sitemap.xml .well-known
cp "$HERE/upstream/static/icon.png" icon.png
cd "$HERE"
python3 "$KIT/pwa.py" "$HERE/desk"
python3 "$KIT/claysafe.py" "$HERE/desk/web"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
