#!/bin/bash
# Build Omni Tools (https://github.com/iib0011/omni-tools) for /omni-tools into desk/web.
# Clones the pinned tag, applies patches/urbit.patch, bundles the Iconify icons the
# app uses, builds with Vite (base /omni-tools/), vendors every runtime download
# (ffmpeg core, Ghostscript WASM, tesseract, Monaco, background-removal model)
# and copies the result to desk/web. See NOTES.md.
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH
TAG=v0.6.0; COMMIT=922b28ce154e8f22da4a721472889717a95f7562
UP="$HERE/upstream"; CACHE="$UP/.urbit-vendor"
if [ ! -d "$UP/.git" ]; then
  rm -rf "$UP"
  git -c advice.detachedHead=false clone -q --depth 1 -b "$TAG" https://github.com/iib0011/omni-tools "$UP"
fi
cd "$UP"
[ "$(git rev-parse HEAD)" = "$COMMIT" ] || { echo "unexpected upstream commit $(git rev-parse HEAD)"; exit 1; }
git apply --reverse --check "$HERE/patches/urbit.patch" 2>/dev/null || git apply "$HERE/patches/urbit.patch"
[ -d node_modules ] || HUSKY=0 npm ci --no-audit --no-fund
mkdir -p "$CACHE"

# fetch <url> <file> <sha256|sha512-base64>: download once into the cache and verify
fetch() {
  local url=$1 out="$CACHE/$2" want=$3 got
  if [ ! -f "$out" ]; then curl -sSfL --retry 3 -o "$out.part" "$url"; mv "$out.part" "$out"; fi
  if [ ${#want} -eq 64 ]; then got=$(sha256sum "$out" | cut -c1-64)
  else got=$(openssl dgst -sha512 -binary "$out" | base64 -w0); fi
  [ "$got" = "$want" ] || { echo "checksum mismatch for $url: $got" >&2; rm -f "$out"; exit 1; }
}

# ---- offline Iconify icons (the app otherwise fetches every icon from api.iconify.design)
ICONIFY_VER=2.2.542
fetch https://registry.npmjs.org/@iconify/json/-/json-$ICONIFY_VER.tgz iconify-json-$ICONIFY_VER.tgz \
  OHlj+amYL+dfR2yyp4YeW/QtqmGIFmaQHSqkFFiL3Dq6YISM4K3sR1sYZzvDgfoXh77bM9LegWEzE1FEgryJ6A==
IJ="$CACHE/iconify-json-$ICONIFY_VER"
if [ ! -d "$IJ" ]; then
  mkdir -p "$IJ.tmp"
  tar xzf "$CACHE/iconify-json-$ICONIFY_VER.tgz" -C "$IJ.tmp" --strip-components=2 --wildcards 'package/json/*.json'
  mv "$IJ.tmp" "$IJ"
fi
node "$HERE/scripts/offline-icons.mjs" "$UP" "$IJ"

# ---- build
rm -rf dist
npx tsc
npx vite build >/dev/null

W="$HERE/desk/web"
rm -rf "$W" && cp -r dist "$W"
rm -f "$W/_redirects" "$W/robots.txt" "$W/gs.js"   # gs.js is an unused placeholder
find "$W" -name '*.map' -delete

# ---- ffmpeg core (single thread, ESM) from the lockfile-pinned node_modules
mkdir -p "$W/ffmpeg"
cp node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.{js,wasm} "$W/ffmpeg/"

# ---- browser-image-compression's web worker script (libURL), from node_modules
cp node_modules/browser-image-compression/dist/browser-image-compression.js "$W/"

# ---- Ghostscript WASM for compress/protect PDF (upstream loads it from cdn-wasm.b-cdn.net;
# the same file is in laurentmmeyer/ghostscript-pdf-compress.wasm, which gs-worker.js comes from)
fetch https://raw.githubusercontent.com/laurentmmeyer/ghostscript-pdf-compress.wasm/78705db4c172c485bd51b6922442a83be8bd361d/src/lib/gs-worker.wasm \
  gs-worker.wasm 2d093d358b088dfa678ad3edc1ccaddfbd5d42addecb452b4d16e5bd13db0232
cp "$CACHE/gs-worker.wasm" "$W/gs-worker.wasm"

# ---- tesseract (image to text): worker, LSTM cores (OEM 1) and the 12 languages the tool offers
T="$W/tesseract"; mkdir -p "$T/core" "$T/lang-data"
cp node_modules/tesseract.js/dist/worker.min.js "$T/"
cp node_modules/tesseract.js-core/tesseract-core*-lstm.wasm.js node_modules/tesseract.js-core/tesseract-core*-lstm.js "$T/core/"
while read -r l sha; do
  [ -n "$l" ] || continue
  fetch "https://registry.npmjs.org/@tesseract.js-data/$l/-/$l-1.0.0.tgz" "tessdata-$l-1.0.0.tgz" "$sha"
  tar xzf "$CACHE/tessdata-$l-1.0.0.tgz" -O "package/4.0.0_best_int/$l.traineddata.gz" > "$T/lang-data/$l.traineddata.gz"
done <<'LANGS'
eng mbTumm6KQPUHyzTPQaF3ObXYnx0SqqfV2nabqFVQBwD6Kl7PhGSLSzOlfFTWy0P3BjghaSKA2W9GB19Jk+ZcTg==
fra pp58gMaoyidoBBLd5y5rnf0WW0Y1994QrGqZrYatITqIU/AReUJMykD+YY3JDgvnmgz7uAx1UmhjjuyEmV8JEA==
deu 3ter1p2gFAiCd5CMC+PodZ9YY2UDomkKj+ytlKeeZqOUmhLx1SDnYPf5zog0g5MBbxYveW+8omI3PUflqHfZ4Q==
spa 9Ln+QKq/TNu4Hy4aOp5b4nXo9U0C6IqJMzNDpAJZe/fNtz6jXG9G/hQgR/Irxj+RGf0M7Xy1MNx1yl4wQUIfeg==
ita Sx19NVYve5VAxEBDL6CWTX+evlvzV+iAS5ejJywcHVsmir/C9Tzw2fExoh97QFc06t48tYZA8VrMobsBzMAEhA==
por sQ7GqYUgKaMmV0vNujYoXLlXUp2e5RGGkJxQ3L59kUOaupIugLJeb1dqhrfgyb71XQw7ltdSuXdQIoaoS/rpsQ==
rus GVOaLultru90gsuVGjXyPCKsg4SMeExnqSnzb8Gb+9zZ0F4wbA6bgWu/metQlcmU7OwTnYVd4UdSH9D4yBMZEA==
jpn nUq2xHUjiWE6FRqkvLIIbByLZ39B8qNaBSOnVP4XIKGPKtZ1e0hiRnK7WhPfl8A+Fe7aNE1u/QoXXUym3TbSCA==
chi_sim iuErURkPbECDUazgsLn/r3c+tU2y5o5S/w14d0A/YiagfsjYyZKgTo75RUpsGJ311qtu0dIX4hqnXAAjmqf2CA==
chi_tra uz0gqF7ncrJS4UTHGCkPntZXpoyo+mIg0Zs8QhF0TH3uzj2HkJpYmi8u1Pdwt2NW65UWJ51hzILWWy838da5dw==
kor tepYhsYiRJ8E44R27MHxVteEDDLfYQxuvM6u4JlEHcCYqwpefvI5TGzoMgB67kunOvtyEJYtT5zfJ/6R6FVU9w==
ara bB60Av6dsv9LRUrlaM6SgnAwjUpdbanw9Jf3mbhDCZAhX7Cp8u7YjI8EWfCvMhH3R2QJT/2EA8cijqPANOhwaA==
LANGS

# ---- Monaco editor (code inputs): the AMD build @monaco-editor/loader loads by default
# (monaco-editor 0.52.2 from cdn.jsdelivr.net; the 0.53 devDependency's AMD build breaks it)
fetch https://registry.npmjs.org/monaco-editor/-/monaco-editor-0.52.2.tgz monaco-editor-0.52.2.tgz \
  GEQWEZmfkOGLdd3XK8ryrfWz3AIP8YymVXiPHEdewrUq7mh0qrKrfHLNCXcbB6sTnMLnOZ3ztSiKcciFUkIJwQ==
mkdir -p "$W/monaco"
tar xzf "$CACHE/monaco-editor-0.52.2.tgz" -C "$W/monaco" --strip-components=2 package/min/vs
cp node_modules/monaco-editor/LICENSE "$W/monaco/LICENSE.txt"

# ---- background removal: the default "medium" model (isnet_fp16) and the CPU onnxruntime,
# from imgly's data CDN, each chunk verified against its sha256 name in resources.json
IMGLY_VER=$(node -p "JSON.parse(require('fs').readFileSync('node_modules/@imgly/background-removal/package.json')).version")
[ "$IMGLY_VER" = 1.7.0 ] || { echo "update the imgly pins for $IMGLY_VER" >&2; exit 1; }
IB=https://staticimgly.com/@imgly/background-removal-data/$IMGLY_VER/dist
fetch "$IB/resources.json" imgly-resources-$IMGLY_VER.json 4e2a359d0436f1e55cb0e4e29a1c943f5d86d639ba4f4b5ea874a699b1f742d3
mkdir -p "$W/imgly"
node - "$CACHE/imgly-resources-$IMGLY_VER.json" "$W/imgly" "$CACHE" "$IB" <<'JS'
const fs = require('fs'), crypto = require('crypto'), { execFileSync } = require('child_process');
const [src, out, cache, base] = process.argv.slice(2);
const keep = ['/models/isnet_fp16', '/onnxruntime-web/ort-wasm-simd-threaded.wasm', '/onnxruntime-web/ort-wasm-simd-threaded.mjs'];
const all = JSON.parse(fs.readFileSync(src, 'utf8')), res = {};
for (const k of keep) {
  res[k] = { ...all[k], chunks: all[k].chunks.map((c) => {
    const f = `${cache}/imgly-${c.hash}`;
    if (!fs.existsSync(f)) execFileSync('curl', ['-sSfL', '--retry', '3', '-o', f, `${base}/${c.name}`]);
    const h = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    if (h !== c.hash) { fs.unlinkSync(f); throw new Error(`hash mismatch for ${c.name}`); }
    fs.copyFileSync(f, `${out}/${c.hash}.bin`);   // clay needs an extension
    return { ...c, name: `${c.hash}.bin` };
  }) };
}
fs.writeFileSync(`${out}/resources.json`, JSON.stringify(res));
JS

cp public/favicon.svg "$W/icon.svg"
python3 "$KIT/pwa.py" "$HERE/desk"
python3 "$KIT/claysafe.py" "$W"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
