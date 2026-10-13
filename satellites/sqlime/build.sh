#!/bin/bash
# Package Sqlime (https://github.com/nalgeon/sqlime) for /sqlime into desk/web.
# Sqlime is plain static HTML/JS with the sqlean (SQLite) wasm vendored in the
# repo, so there is no build step: pin, patch, copy.
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
REPO=https://github.com/nalgeon/sqlime
COMMIT=7c06bfbb403f549b2fbae112177aaf20785459f6

[ -d "$HERE/upstream/.git" ] || git clone "$REPO" "$HERE/upstream"
cd "$HERE/upstream"
git checkout -q -f "$COMMIT" && git clean -fdq
# relative paths, no gist sharing / OpenAI / settings page (see NOTES.md)
git apply --index "$HERE/patches/urbit.patch"

rm -rf "$HERE/desk/web" && mkdir -p "$HERE/desk/web"
cp -r index.html about.html functions.html site.webmanifest css img js demo.db employees.db sales.db "$HERE/desk/web/"
cp LICENSE "$HERE/desk/web/license.txt"
cd "$HERE/desk/web"
rm -f img/cover.png img/cover-examples.png
cp img/favicon.svg icon.svg
cd "$HERE"
python3 "$KIT/pwa.py" "$HERE/desk"
python3 "$KIT/claysafe.py" "$HERE/desk/web"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
