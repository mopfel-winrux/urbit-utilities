#!/bin/bash
# Build Mermaid Live Editor (https://github.com/mermaid-js/mermaid-live-editor)
# for /mermaid into desk/web. Upstream needs node >= 24.16, so a pinned,
# checksum-verified node 24 is fetched into upstream/.node.
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
REPO=https://github.com/mermaid-js/mermaid-live-editor
COMMIT=d46f60bc0fd6b71a56dc73c1711c7b4313b81310
NODEV=v24.21.0
NODESHA=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6

if [ ! -d "$HERE/upstream/.git" ]; then
  git clone "$REPO" "$HERE/upstream"
fi
cd "$HERE/upstream"
git fetch -q origin "$COMMIT" 2>/dev/null || true
git checkout -q -f "$COMMIT"
git clean -fdq -e .node -e node_modules
git apply "$HERE/patches/urbit.patch"

if [ ! -x .node/bin/node ]; then
  T=$(mktemp -d)
  curl -fsSL -o "$T/node.tar.xz" "https://nodejs.org/dist/$NODEV/node-$NODEV-linux-x64.tar.xz"
  echo "$NODESHA  $T/node.tar.xz" | sha256sum -c -
  mkdir -p .node && tar xJf "$T/node.tar.xz" -C .node --strip-components=1 && rm -rf "$T"
fi
export PATH="$PWD/.node/bin:$PATH"

# offline build: no analytics, no mermaid.ai (Mermaid Chart) links or promos,
# no mermaid.ink / kroki renderer links, no hosted privacy policy
export MERMAID_BASE_PATH=/mermaid
export MERMAID_DOMAIN=''
export MERMAID_ANALYTICS_URL=''
export MERMAID_RENDERER_URL=''
export MERMAID_KROKI_RENDERER_URL=''
export MERMAID_IS_ENABLED_MERMAID_CHART_LINKS=false
export MERMAID_HIDE_PRIVACY_POLICY=true
export MERMAID_PRIVACY_POLICY_URL=''
rm -f .env.local

npx -y pnpm@10.34.6 install --frozen-lockfile
npx -y pnpm@10.34.6 run build

rm -rf "$HERE/desk/web" && cp -r docs "$HERE/desk/web"
cd "$HERE/desk/web"
find . -name '*.map' -delete
# prerendered routes as dir/index.html so deep links (/mermaid/edit) get their own page
for r in edit view embed; do mkdir -p $r && mv $r.html $r/index.html; done
rm -f CNAME .nojekyll llms.txt robots.txt sitemap.xml
cp "$HERE/upstream/static/favicon.svg" icon.svg
cd "$HERE"
python3 "$KIT/pwa.py" "$HERE/desk"
python3 "$KIT/claysafe.py" "$HERE/desk/web"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
