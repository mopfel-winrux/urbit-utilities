#!/bin/bash
# Build gwbtc/urbit-mcp into the ship's %mcp desk and register it with Claude Code.
# usage: tools/install-urbit-mcp.sh <pier-dir> [port=8081] [session=fake-zod] [ship=zod]
# needs: zig 0.15.x (0.16 is rejected by its build.zig), git, curl, the `claude` CLI (optional)
set -e
PIER=$1; PORT=${2:-8081}; SESSION=${3:-fake-zod}; SHIP=${4:-zod}
[ -d "$PIER" ] || { echo "usage: $0 <pier-dir> [port] [tmux-session] [ship]"; exit 1; }
[ -d urbit-mcp ] || git clone --quiet https://github.com/gwbtc/urbit-mcp
tmux send-keys -t "$SESSION" '|new-desk %mcp' Enter; sleep 3
tmux send-keys -t "$SESSION" '|mount %mcp' Enter; sleep 3
( cd urbit-mcp && zig build -Ddesk="$(cd "$PIER" && pwd)/mcp" )
tmux send-keys -t "$SESSION" '|commit %mcp' Enter; sleep 8
tmux send-keys -t "$SESSION" '|install our %mcp' Enter; sleep 20
COOKIE=$(bash "$(dirname "$0")/get-cookie.sh" "$PORT")
echo "$COOKIE" > .ship-cookie
echo "cookie saved to .ship-cookie"
if command -v claude >/dev/null; then
  claude mcp remove "$SHIP" -s user >/dev/null 2>&1 || true
  claude mcp add --transport http "$SHIP" "http://localhost:$PORT/mcp" --header "Cookie: $COOKIE" --scope user
  echo "registered MCP server '$SHIP' (takes effect in the next Claude Code session; tools/mcp.sh works now)"
fi
curl -s -o /dev/null -w "mcp endpoint: %{http_code}\n" -H "Cookie: $COOKIE" "http://localhost:$PORT/mcp"
