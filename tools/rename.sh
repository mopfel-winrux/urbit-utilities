#!/bin/bash
# Rename the template's `myapp` to your desk/agent name (lowercase, letters and dashes).
# usage: tools/rename.sh <newname>    (run from the folder that holds desk/)
set -e
N=$1; [ -n "$N" ] || { echo "usage: $0 <newname>"; exit 1; }
HERE=$(cd "$(dirname "$0")/.." && pwd); cd "$HERE/desk"
for f in $(grep -rl myapp . ; grep -rl MyApp .); do sed -i "s/myapp/$N/g; s/MyApp/$N/g; s/My App/$N/g" "$f"; done 2>/dev/null || true
mv app/myapp.hoon "app/$N.hoon"; mv app/myapp-fileserver.hoon "app/$N-fileserver.hoon"
mv sur/myapp.hoon "sur/$N.hoon"; mv lib/myapp.hoon "lib/$N.hoon"; mv mar/myapp "mar/$N"
echo "renamed to $N; desk.bill, docket, marks, agent, web paths updated"
