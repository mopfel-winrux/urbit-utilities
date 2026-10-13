#!/bin/bash
# Build EmulatorJS (https://github.com/EmulatorJS/EmulatorJS) for /emulatorjs into desk/web.
# Downloads the pinned npm tarballs of EmulatorJS and its prebuilt cores into upstream/,
# checks their sha512 integrity, patches out every external request, and assembles
# a launcher page plus EmulatorJS's data/ folder with the selected cores vendored.
#
# To add a core: append "<core> <npm sha512 integrity>" to CORES (the integrity is
# `npm view @emulatorjs/core-<core>@$VERSION dist.integrity`), and add its system to
# SYSTEMS in src/launcher.js. Cores that need threads (ppsspp, dosbox_pure) can't work
# here: the fileserver can't send the COOP/COEP headers SharedArrayBuffer needs.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
VERSION=4.2.3
EJS_SRI="sha512-7z3qaA4LwyurhuGvdMUDF9xJpEbxC3SNy9+E9tSaOsRo8FCS2QXam/0k/lc9kqHWRFIlLKWahNjPAStyL0rFnw=="
CORES="
fceumm sha512-XX9Vv2N/hzp0TstNMCTSppEs+sg+1lpJpPdSDuRqIO/cwdt7dUcF+WjNX1yQJLRbP5+XwcNHZ6K4BKy8CJpndQ==
snes9x sha512-JTe9Rv9eOuCkgkG4ILwuCZUqNcVI3m9ju1NHTTjridUlFgJSqL4DUqF/vLKN9olCpsqlJFfcCayAOoikJxefwA==
gambatte sha512-Oq3AJL9SKnMsNAmtAP2eN934TQts3NHeaAe0z1BO9Lx/L3xDZKLpxL+XwgcSXIrl4Sx1oXxYEUwD7JjPEQ0DGg==
mgba sha512-daiHzZQKEr+P9fra7j5YoEAXiyYUEtBhFQ8EAV/SeCtrkvqtayU7GQ9LYgoSgzkKSwsbNSskApqGuA9EGARYPA==
genesis_plus_gx sha512-D1e2XA2CPRAjfr0JurpXJgR9dePxl/xHtaE8v1T9BqD9A3DLfobIFWsWU9jCFS4NfUxCvcLdTYdY/We3QzvcTw==
picodrive sha512-FUxeHeJIIKi4XG+UdOoCARDjH7hV11XLb6LFUO644F7Ri08veGqMQkOJAoCP8uXGxa/JdgS7SXqc0a40+vLv2w==
mupen64plus_next sha512-HnnEXbOEpYxD7f2wUJQLxWUpEB0bT2kC56u5s7PLyj/xNI5ckQKka5+ay1QhU2fOv2BuPRwjjhlzmVJmk5e3hw==
pcsx_rearmed sha512-mMbl/NszCryFI15X5QniOqLNL7YGZ6tLP24gr5y1q2ekFOIbtc39BcVTMDEwRndNGovh2nPoCcMjB+W3fgQCog==
melonds sha512-IjsEBNLPPbqU2GSeWEoEkOgAonK3JEyzvoYR3ucgOXu6InzDNdfuA5kP/mMh3d6DwCUbOwfnqGZuZXMTyNE2wA==
stella2014 sha512-bs5az26pMrM6jswhZ5YxBXLpIwclwfdnWVbaEpip7yjJFQHactL7KYH7hVLts0JWDnfEK2lNxh4zlTfI6HAHmQ==
prosystem sha512-Dd+gkjtXzzO4vNRKh1AtwUL8iKveQgz3Oy+ENx7uUvpUYAoQc/UT5aDfKP5vwgJJOg6ErwDH1ShC0WW100YvZQ==
mednafen_pce sha512-PwnQAKKxWT8m8dUscH4VX8jcClvgxgR/NkE6FxNE8qiRDyBH3Jze7+tF9+UdWLoJRBwssR5knd7o/Es9xIlU6A==
mednafen_ngp sha512-q/BhrhIk1+yGQ8zXPHaRXMm7Bqgu+7RkRTwbnUSlH3E/ybj8npA3SOP8tvA8TK2ceZU2F5pWdDAwp3dzR3iikg==
mednafen_wswan sha512-ePj0OoSTErXS171PCUsiZl3OrfPJVwupvRYFiMSzu6K2UaQjK3ESThWf8Rh1niJt1F1OQyjQENAeElSm0IcojQ==
beetle_vb sha512-/e6qkA/spYw27qDmzxMiMW5ic36N5W1AVU3Qki8BTZGWKXDseZtNuV/zlPts9rwtTuH8k4+fsQLF+dHp905+/Q==
fbneo sha512-54Yx8Kcq8DH42caTakws3pMUZc6UkBNqtZgg7Q04lNmWWc/W0wPGN0gHxG90xmlOFGHHtxp9QnicBb1NXMjGWg==
vice_x64sc sha512-gNnVRa/aXmzMXp1+7WXdlW7nIx21O2lS2j4eFt5dun8U6XnSKsqSpsyguJiotlKxzEGtzuE0BZRdSnh/YJQdFA==
"
UP="$HERE/upstream"; WEB="$HERE/desk/web"
mkdir -p "$UP/tgz"

# fetch <npm package name> <file stem> <sri>: download the tarball if missing, verify sha512
fetch() {
  local pkg=$1 stem=$2 sri=$3 f="$UP/tgz/$2-$VERSION.tgz"
  if [ ! -f "$f" ]; then
    curl -fsSL -o "$f.part" "https://registry.npmjs.org/@emulatorjs/$pkg/-/$stem-$VERSION.tgz"
    mv "$f.part" "$f"
  fi
  local got="sha512-$(openssl dgst -sha512 -binary "$f" | base64 -w0)"
  [ "$got" = "$sri" ] || { echo "checksum mismatch for $f" >&2; rm -f "$f"; exit 1; }
  rm -rf "$UP/$stem" && mkdir -p "$UP/$stem" && tar xzf "$f" -C "$UP/$stem" --strip-components=1
}

fetch emulatorjs emulatorjs "$EJS_SRI"
echo "$CORES" | while read -r core sri; do
  if [ -n "$core" ]; then fetch "core-$core" "core-$core" "$sri"; fi
done

# --- assemble desk/web ---------------------------------------------------
rm -rf "$WEB" && mkdir -p "$WEB/data/cores/reports"
SRC="$UP/emulatorjs/data"
python3 "$HERE/patches/offline.py" "$SRC/src/emulator.js"
if grep -n "cdn.emulatorjs.org\|netplay.emulatorjs.org" "$SRC/src/emulator.js" | grep -v "console\.\|//"; then
  echo "external URL left in emulator.js" >&2; exit 1
fi
# emulator.min.js: the scripts loader.js would otherwise load one by one, in its order
for s in emulator nipplejs shaders storage gamepad GameManager socket.io.min compression; do
  cat "$SRC/src/$s.js"; printf '\n;\n'
done > "$WEB/data/emulator.min.js"
cp "$SRC/emulator.css" "$WEB/data/emulator.min.css"
cp "$SRC/loader.js" "$SRC/version.json" "$WEB/data/"
cp -r "$SRC/compression" "$SRC/localization" "$WEB/data/"
rm -f "$WEB/data/compression/README.md" "$WEB/data/localization/README.md"
echo "$CORES" | while read -r core sri; do
  [ -n "$core" ] || continue
  # only the non-threaded builds: WebGL2 and the legacy (WebGL1) variant
  cp "$UP/core-$core/$core-wasm.data" "$UP/core-$core/$core-legacy-wasm.data" "$WEB/data/cores/"
  cp "$UP/core-$core/reports/$core.json" "$WEB/data/cores/reports/"
done
cp "$UP/emulatorjs/LICENSE" "$WEB/license.txt"
cp "$HERE/src/index.html" "$HERE/src/launcher.js" "$HERE/src/icon.svg" "$WEB/"

python3 "$KIT/pwa.py" "$HERE/desk" --theme "#14161b" --bg "#14161b"
python3 "$KIT/claysafe.py" "$WEB"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
