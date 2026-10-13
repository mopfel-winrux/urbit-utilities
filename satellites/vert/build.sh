#!/bin/bash
# Build VERT (https://github.com/VERT-sh/VERT) for /vert into desk/web.
# upstream/ is a clone on branch `urbit` carrying our patches (see NOTES.md).
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH
if [ ! -d "$HERE/upstream" ]; then
  git clone https://github.com/VERT-sh/VERT "$HERE/upstream"
  echo "upstream cloned without the urbit patches; apply patches/urbit.patch" >&2
  (cd "$HERE/upstream" && git apply "$HERE/patches/urbit.patch")
fi
cd "$HERE/upstream"
[ -f .env ] || cat > .env <<'ENV'
PUB_HOSTNAME=
PUB_PLAUSIBLE_URL=
PUB_ENV=production
PUB_VERTD_URL=
PUB_DISABLE_ALL_EXTERNAL_REQUESTS=true
PUB_DISABLE_FAILURE_BLOCKS=true
PUB_DONATION_URL=
PUB_STRIPE_KEY=
ENV
[ -d node_modules ] || npx -y bun@1 install --frozen-lockfile
# vendored ffmpeg core (upstream loads it from cdn.jsdelivr.net)
if [ ! -f static/ffmpeg/ffmpeg-core.wasm ]; then
  T=$(mktemp -d) && (cd "$T" && npm pack @ffmpeg/core@0.12.10 --silent >/dev/null && tar xzf ffmpeg-core-0.12.10.tgz)
  mkdir -p static/ffmpeg && cp "$T"/package/dist/esm/ffmpeg-core.{js,wasm} static/ffmpeg/ && rm -rf "$T"
fi
npm run build >/dev/null
rm -rf "$HERE/desk/web" && cp -r build "$HERE/desk/web"
cp static/favicon.png "$HERE/desk/web/icon.png"
python3 "$KIT/pwa.py" "$HERE/desk"
python3 "$KIT/claysafe.py" "$HERE/desk/web"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
