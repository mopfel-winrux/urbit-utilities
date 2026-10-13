#!/bin/bash
# Build the %utilities hub and every satellite desk from a fresh clone.
#
# usage: tools/build-all.sh [--keep-going] [desk ...]
#   no desks   build every desk in catalog.json, then the hub
#   desk ...   build just those (use "utilities" for the hub)
#   --keep-going  carry on after a failed build (default: stop at the first)
#
# Each satellite's build.sh fetches its upstream into satellites/<desk>/upstream/,
# patches and builds it into satellites/<desk>/desk/web/. Logs go to build/logs/.
# Then the satellite icons are copied into the hub and the catalog is compiled.
# Next step: tools/publish.sh <pier> to commit the desks to your ship.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
LOGS="$ROOT/build/logs"; mkdir -p "$LOGS"
KEEP=0; DESKS=()
for a in "$@"; do
  case "$a" in
    --keep-going) KEEP=1 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) DESKS+=("$a") ;;
  esac
done
ALL=$(python3 -c "import json;print(' '.join(a['desk'] for a in json.load(open('$ROOT/catalog.json'))))")
[ ${#DESKS[@]} -eq 0 ] && DESKS=($ALL utilities)

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ---- prerequisites --------------------------------------------------------
say "== checking prerequisites"
for t in git curl rsync python3 tar sha256sum; do
  command -v $t >/dev/null || die "missing: $t"
done
python3 -c 'import venv, ensurepip' 2>/dev/null || die "python3 needs the venv module (e.g. apt install python3-venv)"
# node 22: prefer the one on PATH, else any nvm-installed v22
nv() { node -v 2>/dev/null | sed 's/^v//; s/\..*//'; }
if [ "$(nv)" != 22 ]; then
  n22=$(ls -d "$HOME"/.nvm/versions/node/v22.*/bin 2>/dev/null | sort -V | tail -1)
  [ -n "$n22" ] && export PATH="$n22:$PATH"
fi
[ "$(nv)" = 22 ] || die "need node 22 (found $(node -v 2>/dev/null || echo none)). Install it, e.g.: nvm install 22"
echo "node $(node -v), npm $(npm -v), python $(python3 -V | cut -d' ' -f2)"
# headless Chrome renders the PWA icons (kit/pwa.py) and some build steps
if [ -z "${CHROME:-}" ]; then
  CHROME=$(ls -d "$HOME"/.cache/puppeteer/chrome/linux-*/chrome-linux64/chrome 2>/dev/null | sort -V | tail -1)
fi
if [ -z "$CHROME" ] || [ ! -x "$CHROME" ]; then
  say "== installing headless Chrome into ~/.cache/puppeteer (needed for icons)"
  (cd /tmp && npx -y @puppeteer/browsers install chrome@stable --path "$HOME/.cache/puppeteer") >/dev/null || die "could not install Chrome; set CHROME=/path/to/chrome"
  CHROME=$(ls -d "$HOME"/.cache/puppeteer/chrome/linux-*/chrome-linux64/chrome | sort -V | tail -1)
fi
export CHROME
echo "chrome $CHROME"
free_gb=$(df -Pk "$ROOT" | awk 'NR==2{print int($4/1048576)}')
[ "$free_gb" -lt 20 ] && echo "warning: only ${free_gb} GB free; a full build needs roughly 20 GB (upstream clones and node_modules)"

# ---- build ----------------------------------------------------------------
declare -A RESULT
t0=$(date +%s)
for d in "${DESKS[@]}"; do
  [ "$d" = utilities ] && continue
  sh="$ROOT/satellites/$d/build.sh"
  [ -x "$sh" ] || [ -f "$sh" ] || { RESULT[$d]="no build.sh"; continue; }
  s=$(date +%s); printf '%-12s building... ' "$d"
  if bash "$sh" > "$LOGS/$d.log" 2>&1; then
    size=$(du -sh "$ROOT/satellites/$d/desk" | cut -f1)
    RESULT[$d]="ok   $size  $(( $(date +%s) - s ))s"
  else
    RESULT[$d]="FAILED (see build/logs/$d.log)"
  fi
  echo "${RESULT[$d]}"
  if [[ ${RESULT[$d]} == FAILED* ]] && [ $KEEP = 0 ]; then
    tail -20 "$LOGS/$d.log"; die "stopping; rerun with --keep-going to build the rest"
  fi
done

# ---- hub ------------------------------------------------------------------
if [[ " ${DESKS[*]} " == *" utilities "* ]]; then
  printf '%-12s building... ' utilities
  icons="$ROOT/hub/desk/web/icons"
  for d in $ALL; do
    for ext in svg png; do
      f="$ROOT/satellites/$d/desk/web/icon.$ext"
      [ -f "$f" ] && { cp "$f" "$icons/$d.$ext"; break; }
    done
  done
  if { python3 "$ROOT/hub/gen-catalog.py" && python3 "$ROOT/kit/marks.py" "$ROOT/hub/desk" && python3 "$ROOT/kit/check.py" "$ROOT/hub/desk"; } > "$LOGS/utilities.log" 2>&1; then
    RESULT[utilities]="ok   $(du -sh "$ROOT/hub/desk" | cut -f1)"
  else
    RESULT[utilities]="FAILED (see build/logs/utilities.log)"
  fi
  echo "${RESULT[utilities]}"
fi

# ---- summary --------------------------------------------------------------
say "== summary ($(( ($(date +%s) - t0) / 60 )) min)"
fail=0
for d in "${DESKS[@]}"; do
  printf '  %-12s %s\n' "$d" "${RESULT[$d]:-skipped}"
  [[ ${RESULT[$d]:-} == ok* ]] || fail=1
done
if [ $fail = 0 ]; then
  say "All built. Next: tools/publish.sh /path/to/pier   (see README.md)"
else
  die "Some desks failed to build."
fi
