#!/bin/bash
# Boot a fresh fake ship in a tmux session and wait for the dojo.
# usage: tools/boot-fakezod.sh [ship=zod] [port=8081] [pier-dir=./<ship>] [vere=urbit]
set -e
SHIP=${1:-zod}; PORT=${2:-8081}; PIER=${3:-./$SHIP}; VERE=${4:-${VERE:-urbit}}
SESSION="fake-$SHIP"
if tmux has-session -t "$SESSION" 2>/dev/null; then echo "tmux session $SESSION already exists"; exit 1; fi
if [ -d "$PIER" ]; then
  echo "pier $PIER exists: restarting it"
  tmux new-session -d -s "$SESSION" "$VERE $PIER --http-port $PORT"
else
  echo "booting fake ~$SHIP into $PIER (downloads a pill; a few minutes)"
  tmux new-session -d -s "$SESSION" "$VERE -F $SHIP -c $PIER --http-port $PORT"
fi
for i in $(seq 1 90); do
  if tmux capture-pane -pt "$SESSION" -S -20 | grep -q "~$SHIP:dojo>"; then
    echo "dojo is up. session=$SESSION port=$PORT"; exit 0
  fi
  sleep 10
done
echo "timed out waiting for the dojo; inspect with: tmux attach -t $SESSION"; exit 1
