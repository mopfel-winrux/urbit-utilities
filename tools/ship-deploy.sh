#!/bin/bash
# Deploy one desk directory to a fake ship over its tmux dojo, then install it.
# usage: tools/ship-deploy.sh <desk> <desk-dir> [session=fake-nus] [pier=./nus] [--no-install]
# Creates and mounts the desk the first time, rsyncs, commits, waits for the
# dojo to go quiet, prints any errors from the commit, and installs it from our.
set -e
DESK=$1; SRC=${2%/}; SESSION=${3:-fake-nus}; PIER=${4:-./nus}; NOINSTALL=$5
[ -d "$SRC" ] || { echo "no desk dir $SRC"; exit 1; }
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SHIP=$(tmux capture-pane -pt "$SESSION" -S -5 | grep -oE '~[a-z]+:dojo>' | tail -1 | cut -d: -f1)

dojo() { tmux send-keys -t "$SESSION" "$1" Enter; }
# wait until the pane stops changing for $1 seconds (default 8), max $2 seconds
settle() {
  local quiet=${1:-8} max=${2:-900} last="" same=0 t=0
  while [ $t -lt $max ]; do
    sleep 2; t=$((t+2))
    cur=$(tmux capture-pane -pt "$SESSION" -S -3 | md5sum)
    if [ "$cur" = "$last" ]; then same=$((same+2)); [ $same -ge $quiet ] && return 0; else same=0; last=$cur; fi
  done
  echo "dojo did not settle in ${max}s"; return 1
}

if [ ! -d "$PIER/$DESK" ]; then
  dojo "|new-desk %$DESK"; settle 4 60
  dojo "|mount %$DESK"; settle 4 60
  dojo "|public %$DESK"; settle 4 60   # other ships can only sync public desks
  [ -d "$PIER/$DESK" ] || { echo "mount failed for %$DESK"; exit 1; }
fi
tmux clear-history -t "$SESSION"
rsync -a --delete "$SRC/" "$PIER/$DESK/"
dojo "|commit %$DESK"; settle 10 1800
errs=$(tmux capture-pane -pt "$SESSION" -S -2000 | sed -n "\#^> |commit %$DESK\$#h;\#^> |commit %$DESK\$#!H;\${x;p}" | grep -vE '^\+ |^- |^: |mdns' | grep -iE 'nest-fail|mint|find\.|error|crash|bail|syntax|-need|-have' | head -15 || true)
if [ -n "$errs" ]; then echo "== commit %$DESK reported:"; echo "$errs"; exit 1; fi
if [ "$NOINSTALL" != "--no-install" ]; then
  dojo "|install our %$DESK"; settle 8 300
  errs=$(tmux capture-pane -pt "$SESSION" -S -2000 | sed -n "\#^> |install our %$DESK\$#h;\#^> |install our %$DESK\$#!H;\${x;p}" | grep -vE '^[+:-] |mdns' | grep -iE 'nest-fail|mint|error|crash|bail|not installed' | head -10 || true)
  [ -n "$errs" ] && { echo "== install %$DESK reported:"; echo "$errs"; exit 1; }
fi
echo "deployed %$DESK to $SHIP"
