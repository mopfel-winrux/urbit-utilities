#!/bin/bash
# Call the ship's urbit-mcp endpoint with curl (works even when the MCP client isn't connected).
# usage: tools/mcp.sh list
#        tools/mcp.sh <tool> '<json args>'      e.g. tools/mcp.sh mcp/commit-desk '{"desk":"myapp"}'
# useful tools: mcp/commit-desk {desk}   mcp/test-build {desk,path:"/app/x/hoon"}   mcp/install-app {desk,ship:"~zod"}
#               dojo/command {command}   mcp/scry-agent {agent,path:"/state/json"}  mcp/poke-our-agent {agent,mark,data}
HERE=$(cd "$(dirname "$0")/.." && pwd)
C="${SHIP_COOKIE:-$(cat "$HERE/.ship-cookie" 2>/dev/null || cat ./.ship-cookie 2>/dev/null)}"
[ -n "$C" ] || { echo "no cookie: set SHIP_COOKIE or run tools/get-cookie.sh > .ship-cookie" >&2; exit 1; }
URL="${SHIP_MCP_URL:-http://localhost:${SHIP_PORT:-8081}/mcp}"
H=(-H "Cookie: $C" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream")
if [ "$1" = list ]; then curl -s "${H[@]}" "$URL" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'; exit; fi
curl -s "${H[@]}" "$URL" -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":${2:-{\}}}}" \
  | sed -n 's/^data: //p' | python3 -c '
import json,sys
for line in sys.stdin:
    try: d=json.loads(line)
    except Exception: continue
    r=d.get("result",{})
    for c in r.get("content",[]):
        if c.get("type")=="text": print(c["text"])
    if r.get("isError"): sys.exit(1)'
