#!/bin/bash
# Build BentoPDF (https://github.com/alam00000/bentopdf) for /bentopdf into desk/web.
# Clones the pinned tag, applies patches/urbit.patch, builds with Vite using the
# upstream "air-gapped" settings (all WASM, OCR data and fonts served from
# /bentopdf/wasm/), vendors those packages from npm (integrity-checked) and
# copies the result to desk/web. See NOTES.md.
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH
TAG=v2.8.8; COMMIT=f96cd4e5166f3d51393dfe9f3c440b5bb77802f1
UP="$HERE/upstream"; CACHE="$UP/.urbit-vendor"
if [ ! -d "$UP/.git" ]; then
  rm -rf "$UP"
  git -c advice.detachedHead=false clone -q --depth 1 -b "$TAG" https://github.com/alam00000/bentopdf "$UP"
fi
cd "$UP"
[ "$(git rev-parse HEAD)" = "$COMMIT" ] || { echo "unexpected upstream commit $(git rev-parse HEAD)"; exit 1; }
git apply --reverse --check "$HERE/patches/urbit.patch" 2>/dev/null || git apply "$HERE/patches/urbit.patch"
[ -d node_modules ] || HUSKY=0 npm ci --no-audit --no-fund

# ---- vendored runtime packages (upstream loads these from cdn.jsdelivr.net etc.)
# name@version  sha512 (npm dist.integrity)
PKGS="
@bentopdf/pymupdf-wasm@0.11.16 GPxxH2BokrS49fJa17mrt3hTBGRIDlMkLfJwk+tk45+ICTmIzcti7ACXT2JHK3FUJX916OQvnrJQb29ZajN3CA==
@bentopdf/gs-wasm@0.1.1 EAliG+AxKLf46lOoDreddjOQtyTZGekJ2KRUXjygMFeg8vimOX44QKpim+t3HGHn0eXKbtsItcdN7qcjMSiuYQ==
coherentpdf@2.5.5 AAD3RG7lq2n34AtH352sbNDhJ82yfp2vFUp63/+Vu7snAqW0vyvY33XuhZdj6ubZUlFe1DNSSEaYcyc7+jTJ5Q==
tesseract.js-core@7.0.0 WnNH518NzmbSq9zgTPeoF8c+xmilS8rFIl1YKbk/ptuuc7p6cLNELNuPAzcmsYw450ca6bLa8j3t0VAtq435Vw==
@tesseract.js-data/eng@1.0.0 mbTumm6KQPUHyzTPQaF3ObXYnx0SqqfV2nabqFVQBwD6Kl7PhGSLSzOlfFTWy0P3BjghaSKA2W9GB19Jk+ZcTg==
@tesseract.js-data/deu@1.0.0 3ter1p2gFAiCd5CMC+PodZ9YY2UDomkKj+ytlKeeZqOUmhLx1SDnYPf5zog0g5MBbxYveW+8omI3PUflqHfZ4Q==
@tesseract.js-data/fra@1.0.0 pp58gMaoyidoBBLd5y5rnf0WW0Y1994QrGqZrYatITqIU/AReUJMykD+YY3JDgvnmgz7uAx1UmhjjuyEmV8JEA==
@tesseract.js-data/spa@1.0.0 9Ln+QKq/TNu4Hy4aOp5b4nXo9U0C6IqJMzNDpAJZe/fNtz6jXG9G/hQgR/Irxj+RGf0M7Xy1MNx1yl4wQUIfeg==
@embedpdf/fonts-jp@1.0.0 BY2tv/mcICUUKf+M/bizf3RU65PMqKClJ/e5o9mgMibxyML0OQvEDwYMRPODQkKgJKXCO3ScHmVvcmXp6kt+fA==
@embedpdf/fonts-kr@1.0.0 bh88HXSvOBS581kgmihWY7Ijp9hBsvlmXogFG5LSNx9UBAobRcakZiFMGieRBc06hUSkpo7WhjaFM/z/SfQ8dQ==
@embedpdf/fonts-sc@1.0.0 ETXl7XCwaQLSSvMO3EUDwMNqtL64kX2LlFxarTRi/NsIGGOIxUurGfKtrkmtnKHrWy1jAJSt6oxK2uJhvdvQIw==
@embedpdf/fonts-tc@1.0.0 rGZJbVD6DYS5BbXdpEMnWkpVF0Knar+bsiyb2o3+YRx7O8eyFubEBQUSUInirQk69HA6fc3GhYCg7TyC/oD76Q==
@embedpdf/fonts-arabic@1.0.0 SnGvQb+LwPZQO2WjjvlmXrJZolJUfLYbLZQSaYUw1vrQyMyJKT4LewvJGG+hZ+Yz2fz7OMIQ+4Gc98mGODZtOg==
@embedpdf/fonts-hebrew@1.0.0 5HVAKGL7VqPeTxxADDrSqAFBxfmAXdP8fIqrPwJIKkqdK2643bOer8CqnnpO3/nPoFhkzxhttWMB9BGiqSW62w==
@embedpdf/fonts-latin@1.0.0 LLYysdr8O6sRNzhmW3PbF3AeA8xnqvOi4XLFfIfNlW5uEZ+qsJdcfd78Q78sFJMhlaOAYFMziMMsnOzmx463rA==
"
mkdir -p "$CACHE"
pkgdir() { # name@ver sha512 -> extracted dir (verified on first extraction)
  local spec=$1 want=$2 tgz dir
  tgz="$CACHE/$(echo "$spec" | tr '@/' '__').tgz"; dir="${tgz%.tgz}"
  if [ ! -d "$dir" ]; then
    if [ ! -f "$tgz" ]; then
      local tmp; tmp=$(mktemp -d)
      (cd "$tmp" && npm pack "$spec" --silent >/dev/null) && mv "$tmp"/*.tgz "$tgz" && rm -rf "$tmp"
    fi
    got=$(openssl dgst -sha512 -binary "$tgz" | base64 -w0)
    [ "$got" = "$want" ] || { echo "integrity mismatch for $spec: $got" >&2; rm -f "$tgz"; exit 1; }
    mkdir -p "$dir" && tar xzf "$tgz" -C "$dir" --strip-components=1
  fi
  echo "$dir"
}
while read -r spec sha; do [ -n "$spec" ] && pkgdir "$spec" "$sha" >/dev/null; done <<< "$PKGS"
vdir() { pkgdir "$1" unused; }

# ---- build (vite only: we skip the per-language page copies, sitemap and SEO audit)
export BASE_URL=/bentopdf/ DISABLE_GITHUB_STARS=true \
  VITE_WASM_PYMUPDF_URL=/bentopdf/wasm/pymupdf/ VITE_WASM_GS_URL=/bentopdf/wasm/gs/ \
  VITE_WASM_CPDF_URL=/bentopdf/wasm/cpdf/ \
  VITE_TESSERACT_WORKER_URL=/bentopdf/wasm/ocr/worker.min.js \
  VITE_TESSERACT_CORE_URL=/bentopdf/wasm/ocr/core VITE_TESSERACT_LANG_URL=/bentopdf/wasm/ocr/lang-data \
  VITE_TESSERACT_AVAILABLE_LANGUAGES=eng,deu,fra,spa \
  VITE_OCR_FONT_BASE_URL=/bentopdf/wasm/ocr/fonts VITE_EMBEDPDF_FONTS_URL=/bentopdf/wasm/embedpdf \
  VITE_CORS_PROXY_URL= VITE_USE_CDN=false
rm -rf dist
npx tsc
npx vite build >/dev/null

W="$HERE/desk/web"
rm -rf "$W" && cp -r dist "$W"
# drop precompressed copies (the fileserver serves raw bytes), source maps, type
# declarations, SEO/hosting leftovers and test data; keep LibreOffice's *.gz (it
# gunzips them itself)
find "$W" -name '*.br' -delete
find "$W" -name '*.gz' ! -path '*/libreoffice-wasm/*' -delete
find "$W" \( -name '*.map' -o -name '*.d.mts' -o -name '*.d.ts' -o -name 'CHANGELOG.md' \) -delete
rm -f "$W"/pdfjs-annotation-viewer/pdfjs-annotation-extension-testdata.json "$W"/robots.txt "$W"/sitemap*.xml
rm -rf "$W"/.well-known "$W"/_headers "$W"/_redirects

# the embedpdf viewer's shadow-DOM CSS pulls Open Sans from Google Fonts; drop it
# (the viewer falls back to the system sans-serif)
grep -l "fonts.googleapis.com" "$W"/assets/*.js | xargs -r sed -i "s#@import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600&display=swap');##"
! grep -rl "fonts.googleapis.com" "$W"/assets || { echo "Google Fonts reference left in the build" >&2; exit 1; }

# new cache name per build, so cache-first assets with fixed names (WASM) refresh
VER=$( (echo "$TAG"; cat "$HERE/patches/urbit.patch"; ls -R "$W" | sha256sum) | sha256sum | cut -c1-12)
sed -i "s/^const CACHE_VERSION = 'bentopdf-v11';/const CACHE_VERSION = 'bentopdf-v11-$VER';/" "$W/sw.js"
grep -q "bentopdf-v11-$VER" "$W/sw.js" || { echo "sw.js cache version not set" >&2; exit 1; }

# ---- vendored files, laid out like upstream's scripts/prepare-airgap.sh
V="$W/wasm"; mkdir -p "$V"/{pymupdf,gs,cpdf,ocr/core,ocr/lang-data,ocr/fonts,embedpdf}
d=$(vdir @bentopdf/pymupdf-wasm@0.11.16); cp -r "$d"/{assets,dist,package.json,LICENSE} "$V/pymupdf/"
d=$(vdir @bentopdf/gs-wasm@0.1.1); cp "$d"/assets/* "$d/LICENSE" "$V/gs/"
# PyMuPDF's pdf-to-docx RGB pass imports <gs url>/dist/index.js and loads from
# <gs url>/assets/; point that at the same flat directory instead of duplicating gs.wasm
mkdir -p "$V/gs/dist" && cp "$d/dist/index.js" "$V/gs/dist/gs-wasm.js"
cat > "$V/gs/dist/index.js" <<'JS'
// urbit: gs.js and gs.wasm live one level up (not in assets/)
import { loadGhostscriptWASM as load } from './gs-wasm.js';
export async function loadGhostscriptWASM(options) {
  return load({ ...options, baseUrl: new URL('../', import.meta.url).href });
}
export default loadGhostscriptWASM;
JS
d=$(vdir coherentpdf@2.5.5); cp "$d"/dist/coherentpdf.browser.min.js "$d/LICENSE.md" "$V/cpdf/"
# OCR always runs with OEM 1 (LSTM only), so only the *-lstm cores are needed
d=$(vdir tesseract.js-core@7.0.0); cp "$d"/tesseract-core*-lstm.wasm.js "$d"/tesseract-core*-lstm.js "$d/LICENSE" "$V/ocr/core/"
cp node_modules/tesseract.js/dist/worker.min.js "$V/ocr/worker.min.js"
for l in eng deu fra spa; do d=$(vdir @tesseract.js-data/$l@1.0.0); cp "$d"/4.0.0_best_int/$l.traineddata.gz "$V/ocr/lang-data/"; done
# OCR text-layer font for the bundled (Latin) languages: Noto Sans
cp "$(vdir @embedpdf/fonts-latin@1.0.0)"/fonts/NotoSans-Regular.ttf "$V/ocr/fonts/"
# PDF editor fallback fonts (src/js/config/editor-fonts.ts): <pkg>@1.0.0/fonts/<file>
for f in jp:NotoSansJP-Regular.otf kr:NotoSansKR-Regular.otf sc:NotoSansHans-Regular.otf \
         tc:NotoSansHant-Regular.otf arabic:NotoNaskhArabic-Regular.ttf \
         hebrew:NotoSansHebrew-Regular.ttf latin:NotoSans-Regular.ttf; do
  p=${f%%:*}; file=${f#*:}; d=$(vdir @embedpdf/fonts-$p@1.0.0)
  mkdir -p "$V/embedpdf/fonts-$p@1.0.0/fonts" && cp "$d/fonts/$file" "$V/embedpdf/fonts-$p@1.0.0/fonts/"
done

# extensionless files (license texts) can't be served: give them .txt
find "$W" -type f ! -name '*.*' -exec mv {} {}.txt \;
cp public/images/favicon.svg "$W/icon.svg"
python3 "$KIT/pwa.py" "$HERE/desk"
# pwa.py fixes index.html only; every tool page links the manifest too
find "$W" -maxdepth 1 -name '*.html' -exec sed -i 's#<link rel="manifest" href="/bentopdf/site.webmanifest" />#<link rel="manifest" href="/bentopdf/site.webmanifest" crossorigin="use-credentials">#' {} +
python3 "$KIT/claysafe.py" "$W"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
