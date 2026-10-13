#!/bin/bash
# Copy desk/ into the mounted desk, commit, and build-check every hoon file.
# usage: tools/deploy.sh <pier-dir> [desk=myapp] [--install]
set -e
PIER=$1; DESK=${2:-myapp}; HERE=$(cd "$(dirname "$0")/.." && pwd)
[ -d "$PIER/$DESK" ] || { echo "$PIER/$DESK is not mounted. In the dojo: |new-desk %$DESK then |mount %$DESK"; exit 1; }
rsync -a --delete "$HERE/desk/" "$PIER/$DESK/"
"$HERE/tools/mcp.sh" mcp/commit-desk "{\"desk\":\"$DESK\"}"
fail=0
for f in $(cd "$HERE/desk" && find app lib sur mar -name '*.hoon' | sort); do
  p="/${f%.hoon}/hoon"
  out=$("$HERE/tools/mcp.sh" mcp/test-build "{\"desk\":\"$DESK\",\"path\":\"$p\"}" 2>&1) || { echo "== $p"; echo "$out" | head -40; fail=1; }
done
[ $fail = 0 ] && echo "all hoon files build"
if [ "$3" = "--install" ]; then "$HERE/tools/mcp.sh" mcp/install-app "{\"desk\":\"$DESK\",\"ship\":\"~zod\"}"; sleep 10; fi
exit $fail
