#!/bin/bash
# Copy hub/desk into a mounted %utilities desk, commit and build-check the agent.
# usage: hub/deploy.sh [pier=nus] [tmux-session=fake-nus]
set -e
HUB=$(cd "$(dirname "$0")" && pwd); ROOT=$(dirname "$HUB")
PIER=${1:-$ROOT/nus}; SES=${2:-fake-nus}
python3 "$HUB/gen-catalog.py" >/dev/null
python3 "$ROOT/kit/marks.py" "$HUB/desk" >/dev/null
rsync -a --delete "$HUB/desk/" "$PIER/utilities/"
tmux clear-history -t "$SES"
tmux send-keys -t "$SES" '|commit %utilities' Enter
sleep 6
for f in /app/utilities/hoon /lib/utilities/hoon; do
  tmux send-keys -t "$SES" -l -- "-build-file /=utilities=$f"
  tmux send-keys -t "$SES" Enter
  sleep 4
done
tmux capture-pane -pt "$SES" -S -60 | grep -v '^\s*$' | tail -40
