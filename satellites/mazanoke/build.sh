#!/bin/bash
# Build MAZANOKE (https://github.com/civilblur/mazanoke) for /mazanoke into desk/web.
# It is a static site: no bundler. We clone the pinned tag, apply patches/urbit.patch
# and copy the served files (what upstream's Dockerfile copies) into desk/web.
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
TAG=v1.1.7; COMMIT=41d2ddfc1eda40f7d7c603754296b06982421287
if [ ! -d "$HERE/upstream/.git" ]; then
  rm -rf "$HERE/upstream"
  git clone -q --depth 1 -b "$TAG" https://github.com/civilblur/mazanoke "$HERE/upstream"
fi
cd "$HERE/upstream"
[ "$(git rev-parse HEAD)" = "$COMMIT" ] || { echo "unexpected upstream commit $(git rev-parse HEAD)"; exit 1; }
# apply our patch unless it is already applied
if ! git apply --reverse --check "$HERE/patches/urbit.patch" 2>/dev/null; then
  git apply "$HERE/patches/urbit.patch"
fi
W="$HERE/desk/web"
rm -rf "$W" && mkdir -p "$W"
cp -r index.html assets favicon.ico manifest.json "$W/"
# same as upstream's scripts/environment.common.js: show the version in the footer
VER=$(sed -n 's/^const APP_VERSION = "\(.*\)";/\1/p' service-worker.js)
sed -i "s|<!-- app-version-placeholder -->|<span>•</span><span>$VER</span>|" "$W/index.html"
cp "$W/assets/images/android-chrome-512x512.png" "$W/icon.png"
python3 "$KIT/pwa.py" "$HERE/desk"
python3 "$KIT/claysafe.py" "$W"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
