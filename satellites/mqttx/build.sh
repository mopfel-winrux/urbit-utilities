#!/bin/bash
# Build MQTTX Web (https://github.com/emqx/MQTTX, web/) for /mqttx into desk/web.
# Idempotent: upstream/ is reset to the pinned tag and patches/urbit.patch is
# re-applied on every run (node_modules is kept to save time).
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
REPO=https://github.com/emqx/MQTTX TAG=v1.13.1 COMMIT=5cf00bfdde761c39fce86a1348cb416311109380
export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH
[ -d "$HERE/upstream/.git" ] || git clone -q --depth 1 -b $TAG $REPO "$HERE/upstream"
cd "$HERE/upstream"
[ "$(git rev-parse HEAD)" = "$COMMIT" ] || { echo "upstream is not at $COMMIT" >&2; exit 1; }
git reset -q --hard && git clean -qfdx -e node_modules -e .yarn-cache
git apply "$HERE/patches/urbit.patch"
cd web
# upstream pins node 18; the webpack 4 toolchain runs on 22 with the legacy OpenSSL provider.
# A private yarn cache avoids corrupt extractions when other builds share ~/.cache/yarn.
npx -y yarn@1.22.22 install --frozen-lockfile --ignore-engines --network-timeout 600000 \
  --cache-folder "$HERE/upstream/.yarn-cache" >/dev/null
BASE_URL=/mqttx/ NODE_OPTIONS=--openssl-legacy-provider node_modules/.bin/vue-cli-service build >/dev/null
OUT="$HERE/desk/web"
rm -rf "$OUT" && cp -r dist "$OUT"
find "$OUT" -name '*.map' -delete
cp public/icons/app.png "$OUT/icon.png"
python3 "$KIT/pwa.py" "$HERE/desk" --name "MQTTX Web" --short MQTTX --theme '#00b173'
python3 "$KIT/claysafe.py" "$OUT"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
