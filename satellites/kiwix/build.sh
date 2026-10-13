#!/bin/bash
# Build kiwix-js (https://github.com/kiwix/kiwix-js) for /kiwix into desk/web.
# Pinned release tarball (sha256-checked) -> upstream/, patched by patch.py,
# bundled with upstream's rollup config (npm ci from upstream's lockfile).
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH
VER=4.4.0
SHA=00dc3c6a7284dd5264c43376bbb77a402e67552ad741e604e8765f2c2f356bf1
TGZ="$HERE/upstream/kiwix-js-$VER.tar.gz"
SRC="$HERE/upstream/kiwix-js-$VER"

mkdir -p "$HERE/upstream"
[ -f "$TGZ" ] || curl -fsSL -o "$TGZ" "https://github.com/kiwix/kiwix-js/archive/refs/tags/$VER.tar.gz"
echo "$SHA  $TGZ" | sha256sum -c --quiet
# re-extract the sources every run so patching is idempotent (node_modules is kept)
tar xzf "$TGZ" -C "$HERE/upstream"
cp "$HERE/ship.js" "$SRC/www/js/ship.js"
python3 "$HERE/patch.py" "$SRC"
cd "$SRC"
[ -d node_modules ] || npm ci --no-audit --no-fund --loglevel=error
npm run build-min >/dev/null

WEB="$HERE/desk/web"
rm -rf "$WEB" && mkdir -p "$WEB"
cp -r dist/. "$WEB/"
# drop what a deployed web app doesn't need (browser-extension manifests, docs, sourcemaps)
rm -f "$WEB"/manifest.json "$WEB"/manifest.v2.json "$WEB"/manifest.fx.v3.json "$WEB"/manifest.webapp \
      "$WEB"/backgroundscript.js "$WEB"/README.md "$WEB"/CHANGELOG.md "$WEB"/package.json \
      "$WEB"/www/css/bootstrap.min.css.map
cp www/img/icons/kiwix_scalable.svg "$WEB/icon.svg"
python3 - "$WEB/manifest.webmanifest" <<'PY'
import json, sys
m = json.load(open(sys.argv[1])); m['name'] = 'Kiwix'; m['short_name'] = 'Kiwix'
json.dump(m, open(sys.argv[1], 'w'), indent=1)
PY
# the web root redirects to www/index.html; it also carries the manifest so kit/pwa.py can normalize it
cat > "$WEB/index.html" <<'HTML'
<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <title>Kiwix</title>
    <link rel="manifest" href="manifest.webmanifest">
    <script>location.replace('www/index.html' + location.search + location.hash);</script>
    <meta http-equiv="refresh" content="0; url=www/index.html">
</head>
<body></body>
</html>
HTML
python3 "$KIT/pwa.py" "$HERE/desk" --name "Kiwix" --short "Kiwix"
# the app page links the same manifest; it needs the login cookie too
sed -i 's#<link rel="manifest" href="../manifest.webmanifest" />#<link rel="manifest" href="../manifest.webmanifest" crossorigin="use-credentials" />#' "$WEB/www/index.html"
grep -q 'manifest.webmanifest" crossorigin="use-credentials"' "$WEB/www/index.html"
python3 "$KIT/claysafe.py" "$WEB"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
