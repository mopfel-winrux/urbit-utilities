#!/bin/bash
# Walk through committing the built desks to your ship (the publisher, e.g. ~nattyv).
# Run it on the machine that holds the pier, after tools/build-all.sh.
#
# usage: tools/publish.sh <pier-dir> [--tmux SESSION] [--all] [desk ...]
#   <pier-dir>     the ship's pier, e.g. ~/piers/nattyv (desks get mounted inside it)
#   --tmux SESSION type the dojo commands into the ship's tmux session for you
#                  (otherwise the script prints each command and waits for you)
#   --all          publish every desk, even ones unchanged since the last publish
#   desk ...       only these desks ("utilities" is the hub); default: all of them
#
# For each desk: create and mount it the first time, copy the build into the
# mount, |commit it, and the first time also |public it (so other ships can
# install it) and |install it. Unchanged desks are skipped (state in .publish/).
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PIER=""; SESSION=""; ALLDESKS=0; DESKS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --tmux) SESSION=$2; shift ;;
    --all) ALLDESKS=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) if [ -z "$PIER" ]; then PIER=${1%/}; else DESKS+=("$1"); fi ;;
  esac
  shift
done
[ -n "$PIER" ] || { sed -n '2,15p' "$0"; exit 1; }

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
note() { printf '\033[36m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$PIER/.urb" ] || die "$PIER doesn't look like a pier (no .urb/ inside)"
command -v rsync >/dev/null || die "missing: rsync"
if [ -n "$SESSION" ]; then
  tmux has-session -t "$SESSION" 2>/dev/null || die "no tmux session $SESSION"
  SHIP=$(tmux capture-pane -pt "$SESSION" -S -5 | grep -oE '~[a-z-]+:dojo>' | tail -1 | cut -d: -f1)
  [ -n "$SHIP" ] || die "no dojo prompt visible in tmux session $SESSION"
else
  SHIP="your ship"
fi

ALL=$(python3 -c "import json;print(' '.join(a['desk'] for a in json.load(open('$ROOT/catalog.json'))))")
[ ${#DESKS[@]} -eq 0 ] && DESKS=(utilities $ALL)
src_of() { [ "$1" = utilities ] && echo "$ROOT/hub/desk" || echo "$ROOT/satellites/$1/desk"; }

# ---- dojo: either type into tmux, or ask the human -------------------------
settle() {  # wait until the dojo pane stops changing for $1 s (max $2 s)
  local quiet=$1 max=$2 last="" same=0 t=0 cur
  while [ $t -lt "$max" ]; do
    sleep 2; t=$((t+2))
    cur=$(tmux capture-pane -pt "$SESSION" -S -3 | md5sum)
    if [ "$cur" = "$last" ]; then same=$((same+2)); [ $same -ge "$quiet" ] && return 0; else same=0; last=$cur; fi
  done
  return 1
}
dojo() {  # dojo "<command>" <quiet-seconds> <max-seconds>
  if [ -n "$SESSION" ]; then
    note "  dojo> $1"
    tmux send-keys -t "$SESSION" -l -- "$1"; tmux send-keys -t "$SESSION" Enter
    settle "${2:-6}" "${3:-600}" || note "  (dojo still busy after ${3:-600}s; carrying on)"
    errs=$(tmux capture-pane -pt "$SESSION" -S -2000 | sed -n "\#> $1\$#h;\#> $1\$#!H;\${x;p}" \
      | grep -vE '^[+:-] |mdns' | grep -iE 'nest-fail|mint|bail|crash|error|syntax|-need|-have' | head -8)
    if [ -n "$errs" ]; then
      echo "$errs"; read -rp "  The dojo printed errors (above). Continue anyway? [y/N] " a; [ "$a" = y ] || exit 1
    fi
  else
    bold "  In $SHIP's dojo, type:   $1"
    read -rp "  ...then press Enter here once the dojo prompt is back. " _
  fi
}

# ---- plan -------------------------------------------------------------------
mkdir -p "$ROOT/.publish"
STATE="$ROOT/.publish/$(basename "$PIER").state"; touch "$STATE"
hash_of() { (cd "$1" && find . -type f -print0 | sort -z | xargs -0 sha1sum) | sha1sum | cut -c1-16; }

bold "== publishing to $SHIP ($PIER)"
PLAN=()
for d in "${DESKS[@]}"; do
  src=$(src_of "$d")
  if [ ! -d "$src/web" ]; then echo "  $d: not built (run tools/build-all.sh $d), skipping"; continue; fi
  h=$(hash_of "$src")
  if [ $ALLDESKS = 0 ] && grep -qx "$d $h" "$STATE"; then echo "  $d: unchanged, skipping"; continue; fi
  new=""; [ -d "$PIER/$d" ] || new=" (new desk)"
  echo "  $d: $(du -sh "$src" | cut -f1)$new"
  PLAN+=("$d")
done
[ ${#PLAN[@]} -eq 0 ] && { bold "Nothing to publish."; exit 0; }
big=$(for d in "${PLAN[@]}"; do du -sm "$(src_of "$d")" | awk -v d="$d" '$1>100{print d" ("$1" MB)"}'; done)
if [ -n "$big" ]; then
  note "Large desks: $(echo $big). Committing them needs a big loom: run the ship with"
  note "--loom 33 (8 GB). With the default 2 GB loom the commit crashes with 'bail: meme'."
  note "Nothing is lost when that happens; restart with --loom 33 and run this again."
fi
read -rp "Publish ${#PLAN[@]} desk(s)? [y/N] " a; [ "$a" = y ] || exit 0

# ---- publish ----------------------------------------------------------------
i=0
for d in "${PLAN[@]}"; do
  i=$((i+1)); src=$(src_of "$d")
  bold "== [$i/${#PLAN[@]}] %$d"
  first=0
  if [ ! -d "$PIER/$d" ]; then
    first=1
    note "  New desk: create it and mount it into the pier."
    dojo "|new-desk %$d" 4 120
    dojo "|mount %$d" 4 120
    for _ in $(seq 1 30); do [ -d "$PIER/$d" ] && break; sleep 2; done
    [ -d "$PIER/$d" ] || die "  $PIER/$d didn't appear; check the dojo, then run this again"
  fi
  note "  Copying the build into $PIER/$d"
  rsync -a --delete "$src/" "$PIER/$d/"
  note "  Committing (big desks take a few minutes)"
  dojo "|commit %$d" 10 1800
  if [ $first = 1 ]; then
    note "  Making it public so other ships can install it, then installing it here."
    dojo "|public %$d" 4 120
    dojo "|install our %$d" 8 600
  fi
  sed -i "/^$d /d" "$STATE"; echo "$d $(hash_of "$src")" >> "$STATE"
done

bold "== done"
cat <<EOF
$SHIP now hosts the hub and the satellites you published.
  - Open the launcher:      https://<your ship's URL>/utilities/
  - Other ships install it: |install ${SHIP/your ship/~yourship} %utilities
    then install apps from the launcher (they sync from ${SHIP/your ship/your ship}).
  - Desks you created by hand earlier also need |public %<desk> once.
Re-run this script after rebuilding; it only re-commits desks that changed.
EOF
