#!/bin/bash
# Package CyberChef (https://github.com/gchq/CyberChef) for /cyberchef into desk/web,
# from the official pinned, checksum-verified standalone release zip.
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
VER=v11.5.0
ZIP=CyberChef_8cd426dd4f40f1423912d5fad91b578a86a65112.zip
SHA=f6478925d3eaa16ec08626a85f5b85eed10d531a5e18700615fed7ecb024cccf
mkdir -p "$HERE/upstream" && cd "$HERE/upstream"
[ -f "$ZIP" ] || curl -fsSL -o "$ZIP" "https://github.com/gchq/CyberChef/releases/download/$VER/$ZIP"
ICON=cyberchef-512x512.png
ICONSHA=2e0f496d51e17482ddad1b71605592bfd1cd254c7df0939a4dbb3e21b4b578ed
[ -f "$ICON" ] || curl -fsSL -o "$ICON" "https://raw.githubusercontent.com/gchq/CyberChef/$VER/src/web/static/images/$ICON"
printf '%s  %s\n%s  %s\n' "$SHA" "$ZIP" "$ICONSHA" "$ICON" | sha256sum -c -

rm -rf "$HERE/desk/web" && mkdir -p "$HERE/desk/web" && cd "$HERE/desk/web"
unzip -q "$HERE/upstream/$ZIP"
mv "CyberChef_$VER.html" index.html
# drop precompressed copies (the fileserver serves raw files), but keep .gz files
# that are the only copy (tesseract's eng.traineddata.gz is fetched as-is)
find . -type f \( -name '*.br' -o -name '*.gz' \) | while read -r f; do
  [ -e "${f%.*}" ] && rm "$f"; done
find . -name '*.br' -delete
cp "$HERE/upstream/$ICON" icon.png
cd "$HERE"
python3 "$KIT/pwa.py" "$HERE/desk" --name CyberChef --short CyberChef
python3 "$KIT/claysafe.py" "$HERE/desk/web"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
