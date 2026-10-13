#!/bin/bash
# Build Excalidraw (https://github.com/excalidraw/excalidraw, excalidraw-app)
# for /excalidraw into desk/web. Idempotent: upstream/ is reset to the pinned
# tag and re-patched on every run (see NOTES.md).
#   patches/01-urbit.patch  strip collab/firebase/share links/AI/Excalidraw+/
#                           analytics/Sentry/CDN fonts, base path, asset layout
#   patches/02-ship.patch   ship storage drawer (ship/) + public viewer (view/)
# To edit the patches: change files in upstream/, then
#   git -C upstream add -N excalidraw-app/ship excalidraw-app/view && git -C upstream diff
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
REPO=https://github.com/excalidraw/excalidraw
TAG=v0.18.1   # a2ec2889babf7d2295469c6d90ebe77fae57df84
export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH

if [ ! -d "$HERE/upstream/.git" ]; then
  rm -rf "$HERE/upstream"
  git clone --depth 1 -b "$TAG" "$REPO" "$HERE/upstream"
fi
cd "$HERE/upstream"
git reset -q --hard "$TAG" && git clean -fdq   # keeps ignored node_modules/build
for p in "$HERE"/patches/*.patch; do git apply "$p"; done

# no backends: empty every service URL (overrides .env.production)
cat > .env.production.local <<'ENV'
VITE_APP_BACKEND_V2_GET_URL=
VITE_APP_BACKEND_V2_POST_URL=
VITE_APP_LIBRARY_URL=
VITE_APP_LIBRARY_BACKEND=
VITE_APP_PLUS_LP=
VITE_APP_PLUS_APP=
VITE_APP_AI_BACKEND=
VITE_APP_WS_SERVER_URL=
VITE_APP_FIREBASE_CONFIG='{}'
VITE_APP_PLUS_EXPORT_PUBLIC_KEY=
VITE_APP_ENABLE_TRACKING=false
VITE_APP_DISABLE_SENTRY=true
VITE_APP_ENABLE_PWA=false
ENV

[ -d node_modules ] || npx -y yarn@1.22.22 install --frozen-lockfile --ignore-engines
(cd excalidraw-app && rm -rf build && npx vite build --logLevel warn)

WEB="$HERE/desk/web"
rm -rf "$WEB" && cp -r excalidraw-app/build "$WEB"
# upstream public/ leftovers we don't serve: netlify headers, SEO, CRA worker
# killer, legacy root fonts (fonts are under view/fonts), store screenshots
(cd "$WEB" && rm -rf _headers robots.txt service-worker.js og-image-3.png screenshots \
  Assistant-Regular.woff2 Cascadia.woff2 Virgil.woff2)
cp public/favicon.svg "$WEB/icon.svg"

python3 "$KIT/pwa.py" "$HERE/desk" --theme "#121212" --bg "#ffffff"
python3 "$KIT/claysafe.py" "$WEB"
python3 "$KIT/marks.py" "$HERE/desk"
python3 "$KIT/check.py" "$HERE/desk"
