#!/bin/bash
# Build Enclosed (https://github.com/CorentinTh/enclosed) for /enclosed into desk/web.
# Only the client (packages/app-client) is built; the upstream server is replaced
# by the %utilities hub API (see NOTES.md and patches/urbit.patch).
set -e
TAG=v1.9.2
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH
if [ ! -d "$HERE/upstream/.git" ]; then
  rm -rf "$HERE/upstream"
  git clone -q --depth 1 -b "$TAG" https://github.com/CorentinTh/enclosed "$HERE/upstream"
fi
cd "$HERE/upstream"
# reset to the pinned tag and (re)apply our patches, so reruns are idempotent
git reset -q --hard "$TAG"
for p in "$HERE"/patches/*.patch; do git apply "$p"; done
[ -d node_modules ] || npx -y pnpm@9.12.2 install --frozen-lockfile --filter @enclosed/app-client...
cd packages/app-client
# first build downloads the web font into public/assets/fonts (unocss local font
# processor); vite copies public/ before that happens, so build twice if needed
npx vite build >/dev/null
npx vite build >/dev/null
# every font the CSS references must have been vendored
for f in $(grep -oh '/enclosed/assets/fonts/[^)"]*' dist/assets/*.css | sort -u); do
  [ -s "dist/${f#/enclosed/}" ] || { echo "missing vendored font $f (rerun build.sh)" >&2; exit 1; }
done
rm -rf "$HERE/desk/web" && cp -r dist "$HERE/desk/web"
rm -f "$HERE/desk/web/og-image.png"
cp ../docs/src/public/logos/logo-dark-bg.svg "$HERE/desk/web/icon.svg"
cd "$HERE"
python3 "$KIT/pwa.py" desk --name "Enclosed" --short "Enclosed"
python3 "$KIT/claysafe.py" desk/web
python3 "$KIT/marks.py" desk && python3 "$KIT/check.py" desk
