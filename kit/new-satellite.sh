#!/bin/bash
# Scaffold a satellite desk from the kit.
# usage: kit/new-satellite.sh <desk> "<Title>" "<one-line info>" [spa=|] [auth=&] [color=0xf2.abee]
#   desk: lowercase letters, digits, dashes (it is also the web root /<desk>)
set -e
DESK=$1; TITLE=$2; INFO=$3; SPA=${4:-|}; AUTH=${5:-&}; COLOR=${6:-0xf2.abee}
[[ "$DESK" =~ ^[a-z][a-z0-9-]*$ ]] || { echo "bad desk name: $DESK"; exit 1; }
KIT=$(cd "$(dirname "$0")" && pwd); ROOT=$(dirname "$KIT")
OUT="$ROOT/satellites/$DESK/desk"
[ -e "$OUT" ] && { echo "$OUT exists"; exit 1; }
mkdir -p "$OUT"
cp -r "$KIT/desk/." "$OUT/"
mv "$OUT/app/SATELLITE-fileserver.hoon" "$OUT/app/$DESK-fileserver.hoon"
sed -i "s/SATELLITE/$DESK/g" "$OUT/app/$DESK-fileserver.hoon"
sed -i "s/SATELLITE/$DESK/g; s/  SPA$/  ${SPA//&/\\&}/; s/  AUTH$/  ${AUTH//&/\\&}/" "$OUT/app/fileserver/config.hoon"
printf ':~  %%%s-fileserver\n==\n' "$DESK" > "$OUT/desk.bill"
cat > "$OUT/desk.docket-0" <<DOCKET
:~  title+'$TITLE'
    info+'$INFO'
    color+$COLOR
    image+'/$DESK/icon.svg'
    version+[0 1 0]
    website+'https://github.com/'
    license+'MIT'
    base+'$DESK'
    site+/$DESK
==
DOCKET
mkdir -p "$OUT/web"
echo "scaffolded $OUT (edit desk.docket-0: website, license, image; put the build in web/)"
