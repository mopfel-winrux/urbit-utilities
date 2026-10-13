#!/bin/bash
# Build noStrudel (https://github.com/hzrd149/nostrudel) for /nostrudel into desk/web.
# Idempotent: upstream/ is reset to the pinned tag and patches/urbit.patch is
# re-applied on every run (node_modules is kept to save time).
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
REPO=https://github.com/hzrd149/nostrudel TAG=v1.1.0 COMMIT=646d0e7abbef8e49b91b0c0d65a5f8bf36be9619
FA_URL=https://registry.npmjs.org/font-awesome/-/font-awesome-4.7.0.tgz
FA_SHA256=92042b715919e17499ded134884b0318fd88041efac9b0f3204069df52222a61
export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH
[ -d "$HERE/upstream/.git" ] || git clone -q --depth 1 -b $TAG $REPO "$HERE/upstream"
cd "$HERE/upstream"
[ "$(git rev-parse HEAD)" = "$COMMIT" ] || { echo "upstream is not at $COMMIT" >&2; exit 1; }
git reset -q --hard && git clean -qfdx -e node_modules -e .cache
git apply "$HERE/patches/urbit.patch"
# Font Awesome 4.7 for the wiki editor (EasyMDE), woff2/woff only
mkdir -p .cache
[ -f .cache/fa.tgz ] || curl -sSfL -o .cache/fa.tgz $FA_URL
echo "$FA_SHA256  .cache/fa.tgz" | sha256sum -c --quiet
rm -rf .cache/package && tar xzf .cache/fa.tgz -C .cache
mkdir -p src/vendor/font-awesome/css src/vendor/font-awesome/fonts
cp .cache/package/fonts/fontawesome-webfont.woff{,2} src/vendor/font-awesome/fonts/
python3 - <<'PY'
import re
s = open('.cache/package/css/font-awesome.min.css').read()
s = re.sub(r"@font-face\{[^}]*\}", "@font-face{font-family:'FontAwesome';src:url('../fonts/fontawesome-webfont.woff2?v=4.7.0') format('woff2'),url('../fonts/fontawesome-webfont.woff?v=4.7.0') format('woff');font-weight:normal;font-style:normal}", s, count=1)
open('src/vendor/font-awesome/css/font-awesome.min.css', 'w').write(s)
PY
npx -y pnpm@9.14.4 install --frozen-lockfile >/dev/null
rm -rf public/.well-known  # nostrudel.ninja NIP-05 file, not part of the app
VITE_BASE=/nostrudel/ npx -y pnpm@9.14.4 exec vite build >/dev/null
OUT="$HERE/desk/web"
rm -rf "$OUT" && cp -r dist "$OUT"
find "$OUT" -name '*.map' -delete
cp public/logo.svg "$OUT/icon.svg"
python3 "$KIT/pwa.py" "$HERE/desk" --theme '#8DB600'
python3 "$KIT/claysafe.py" "$OUT"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
