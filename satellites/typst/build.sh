#!/bin/bash
# Build Typst Online Editor (https://github.com/Mapaor/typst-online-editor), a
# client-side Typst editor on typst.ts, as a static export for /typst into desk/web.
# Idempotent: upstream/ is reset to the pinned commit and patches/urbit.patch is
# re-applied on every run (node_modules and the download cache are kept).
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
REPO=https://github.com/Mapaor/typst-online-editor COMMIT=55b0c17322b6986ad27030bcbf220c3af9eed2af
# Typst's default fonts, matching the typst-assets version compiled into typst.ts 0.7.0-rc2
ASSETS_URL=https://github.com/typst/typst-assets/archive/refs/tags/v0.14.2.tar.gz
export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH
[ -d "$HERE/upstream/.git" ] || git clone -q $REPO "$HERE/upstream"
cd "$HERE/upstream"
git checkout -q $COMMIT
git reset -q --hard && git clean -qfdx -e node_modules -e .cache
git apply "$HERE/patches/urbit.patch"
npm ci --no-audit --no-fund --cache "$HERE/upstream/.cache/npm" >/dev/null
# fonts: typst-assets, checked file by file against fonts.sha256
mkdir -p .cache public/fonts/typst
[ -f .cache/typst-assets.tgz ] || curl -sSfL -o .cache/typst-assets.tgz $ASSETS_URL
tar xzf .cache/typst-assets.tgz -C public/fonts/typst --strip-components=3 \
  --wildcards 'typst-assets-0.14.2/files/fonts/*.otf' 'typst-assets-0.14.2/files/fonts/*.ttf'
(cd public/fonts/typst && sha256sum -c --quiet "$HERE/fonts.sha256")
(cd public/fonts && sha256sum -c --quiet "$HERE/upstream-fonts.sha256")
rm -f public/fonts/todo-add-fonts.txt
# wasm compiler and pdf.js worker from the locked npm packages (no CDN)
cp node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm public/wasm/
mkdir -p public/pdfjs && cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdfjs/
NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_BASE_PATH=/typst npx next build >/dev/null
OUT="$HERE/desk/web"
rm -rf "$OUT" && cp -r out "$OUT"
find "$OUT" -name '*.map' -delete
cp "$HERE/icon.svg" "$OUT/icon.svg"
python3 "$KIT/pwa.py" "$HERE/desk" --name "Typst" --theme '#239dad'
python3 "$KIT/claysafe.py" "$OUT"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
