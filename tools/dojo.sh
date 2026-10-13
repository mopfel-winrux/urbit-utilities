#!/bin/bash
# Fallback ship control through tmux. usage: tools/dojo.sh '<dojo command>' [session=fake-zod] [wait=8]
# Prefer tools/mcp.sh when urbit-mcp is installed; the dojo can wedge after a
# failed |install (Enter ignored, input concatenated) — if so, wait a minute or ^C.
CMD="$1"; SESSION=${2:-fake-zod}; WAIT=${3:-8}
tmux send-keys -t "$SESSION" "$CMD" Enter
sleep "$WAIT"
tmux capture-pane -pt "$SESSION" -S -60 | grep -v "mdns:" | tail -40
