#!/bin/bash
# Build the %office satellite into desk/web.
# - ZetaOffice (LibreOffice compiled to WebAssembly by allotropia, MPL-2.0),
#   the prebuilt binaries from cdn.zetaoffice.net, pinned by SHA-256
# - zetajs 1.2.0 (MIT) from npm, pinned by SHA-256
# - our UI (src/), which stores documents in the %utilities hub store
# Idempotent: downloads are cached in upstream/ (gitignored) and re-verified.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
UP="$HERE/upstream"; WEB="$HERE/desk/web"
mkdir -p "$UP"

# The CDN only publishes "zetaoffice_latest" (no versioned paths). These sums
# are of the build served there since 2025-05-13 (ETag 682362b6-22993d2 for
# soffice.wasm). If the CDN moves on, the check fails: put the old files in
# upstream/ by hand, or update the sums after testing the new build.
ZO_URL=https://cdn.zetaoffice.net/zetaoffice_latest
declare -A SUM=(
  [soffice.js]=5143e5354f470b87f86ba272bcfef857bd13e6f07b59666e48a7ccb89643cd77
  [soffice.wasm]=9ebd9a487e849a24b9c69f843ebdb451709c27b7722c010e36846433474a5bd4
  [soffice.data]=3dab0a5448e599dccc1b1e69f4f86ea9eb30777c3f1ed7b9c386a5f4163e361c
  [soffice.data.js.metadata]=5d9d909d0b9b38443c0f19704032d0fc12d654f6c9c24c2c3b237739c4848ae3
  [zetajs-1.2.0.tgz]=0caeb32dcd11ddac8d69cd178d7dc297b0220967beafe183942859f24a0d1e4e
)
ok() { [ -f "$UP/$1" ] && echo "${SUM[$1]}  $UP/$1" | sha256sum -c --status; }
fetch() {  # name url
  ok "$1" && return
  echo "fetching $2"
  # the CDN serves wasm/data with Content-Encoding: br; --compressed decodes it
  curl -fL --compressed --retry 3 -o "$UP/$1.part" "$2"
  mv "$UP/$1.part" "$UP/$1"
  ok "$1" || { echo "checksum mismatch for $1 (upstream changed?)" >&2; exit 1; }
}
for f in soffice.js soffice.wasm soffice.data soffice.data.js.metadata; do fetch "$f" "$ZO_URL/$f"; done
fetch zetajs-1.2.0.tgz https://registry.npmjs.org/zetajs/-/zetajs-1.2.0.tgz

# deterministic gzip (no mtime/name) of the two big files; the fileserver
# can't send Content-Encoding, so sw.js decompresses them in the browser
for f in soffice.wasm soffice.data; do
  if [ ! -f "$UP/$f.gz" ] || [ "$UP/$f" -nt "$UP/$f.gz" ]; then
    python3 - "$UP/$f" <<'PY'
import gzip, shutil, sys
src = sys.argv[1]
with open(src, 'rb') as i, open(src + '.gz.part', 'wb') as raw:
    with gzip.GzipFile(filename='', mode='wb', compresslevel=9, fileobj=raw, mtime=0) as o:
        shutil.copyfileobj(i, o, 1 << 20)
PY
    mv "$UP/$f.gz.part" "$UP/$f.gz"
  fi
done

rm -rf "$WEB"; mkdir -p "$WEB"
cp -r "$HERE/src/." "$WEB/"
cp "$UP/soffice.js" "$UP/soffice.data.js.metadata" "$UP/soffice.wasm.gz" "$UP/soffice.data.gz" "$WEB/"
tar -xzf "$UP/zetajs-1.2.0.tgz" -O package/source/zeta.js > "$WEB/zeta.js"

python3 "$KIT/pwa.py" "$HERE/desk" --name "Office" --theme "#0e7c66"
# version the service worker cache by content
VER=$(cd "$WEB" && find . -type f ! -name sw.js -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16)
sed -i "s/__VERSION__/$VER/" "$WEB/sw.js"

python3 "$KIT/claysafe.py" "$WEB"
python3 "$KIT/marks.py" "$HERE/desk"
python3 "$KIT/check.py" "$HERE/desk"
