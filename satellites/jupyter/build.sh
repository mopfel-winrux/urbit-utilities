#!/bin/bash
# Build JupyterLite (https://github.com/jupyterlite/jupyterlite) for /jupyter
# into desk/web, with a vendored Pyodide (core + numpy, pandas, matplotlib and
# the kernel's own deps) and the ship-drive extension (contents on the ship).
# Everything is pinned; downloads are checked against sha256 sums.
#   JUPYTER_VENV=<dir>  python venv to use (default upstream/venv)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
UP="$HERE/upstream"; DL="$UP/dl"; LITE="$UP/lite"; OUT="$UP/_output"
VENV=${JUPYTER_VENV:-$UP/venv}
export PATH=$VENV/bin:$HOME/.nvm/versions/node/v22.22.0/bin:$PATH

JUPYTERLITE_CORE=0.8.6
PYODIDE_KERNEL=0.8.6
JUPYTER_BUILDER=1.2.3
PYODIDE=314.0.6
PYODIDE_CORE_SHA=1016c31e39ce3764d9a418cbb491a392c802c1b86ccc1367f009f5c59bf8f5fd
PYODIDE_CDN=https://cdn.jsdelivr.net/pyodide/v$PYODIDE/full
# pyodide packages to vendor (their dependency closure is added from the lock)
PACKAGES="micropip packaging ipython jedi numpy pandas matplotlib"
# pure-python wheels the kernel needs that pyodide doesn't ship (piplite index)
COMM_WHL=comm-0.2.3-py3-none-any.whl
COMM_URL=https://files.pythonhosted.org/packages/60/97/891a0971e1e4a8c5d2b20bbe0e524dc04548d2307fee33cdeba148fd4fc7/$COMM_WHL
COMM_SHA=c615d91d75f7f04f095b30d1c1711babd43bdc6419c1be9886a85f2f4e489417

mkdir -p "$UP" "$DL"
fetch() { # url dest sha256
  if [ -f "$2" ] && echo "$3  $2" | sha256sum -c --quiet - 2>/dev/null; then return; fi
  curl -fsSL --retry 3 -o "$2.part" "$1"
  echo "$3  $2.part" | sha256sum -c --quiet - || { echo "checksum mismatch: $1" >&2; rm -f "$2.part"; exit 1; }
  mv "$2.part" "$2"
}

# 1. python tooling
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
if ! "$VENV/bin/python" -c "import jupyterlite_core, jupyterlite_pyodide_kernel, jupyter_builder" 2>/dev/null \
   || [ "$("$VENV/bin/python" -c 'import jupyterlite_core;print(jupyterlite_core.__version__)')" != "$JUPYTERLITE_CORE" ]; then
  "$VENV/bin/pip" install -q "jupyterlite-core==$JUPYTERLITE_CORE" \
    "jupyterlite-pyodide-kernel==$PYODIDE_KERNEL" "jupyter-builder==$JUPYTER_BUILDER"
fi

# 2. the ship-drive labextension (source in ship-drive/, built in upstream/)
rm -rf "$UP/ship-drive.src" && mkdir -p "$UP/ship-drive.src"
cp "$HERE/ship-drive/package.json" "$UP/ship-drive.src/" && cp -r "$HERE/ship-drive/lib" "$UP/ship-drive.src/"
( cd "$UP/ship-drive.src"
  if [ -f "$UP/ship-drive-node_modules.stamp" ] && cmp -s package.json "$UP/ship-drive-node_modules.stamp"; then
    mv "$UP/ship-drive-node_modules" node_modules
  else
    rm -rf "$UP/ship-drive-node_modules"; npm install --no-audit --no-fund --silent
  fi
  jupyter-builder build . >/dev/null
  cp package.json "$UP/ship-drive-node_modules.stamp"; mv node_modules "$UP/ship-drive-node_modules" )
EXT="$VENV/share/jupyter/labextensions/jupyterlite-ship-drive"
rm -rf "$EXT" && cp -r "$UP/ship-drive.src/labextension" "$EXT"

# 3. lite dir: config + vendored pyodide + piplite wheels
rm -rf "$LITE" && mkdir -p "$LITE/static" "$LITE/pypi"
cp "$HERE/lite/jupyter-lite.json" "$HERE/lite/jupyter_lite_config.json" "$LITE/"
fetch "https://github.com/pyodide/pyodide/releases/download/$PYODIDE/pyodide-core-$PYODIDE.tar.bz2" \
  "$DL/pyodide-core-$PYODIDE.tar.bz2" "$PYODIDE_CORE_SHA"
tar xjf "$DL/pyodide-core-$PYODIDE.tar.bz2" -C "$LITE/static"
P="$LITE/static/pyodide"
rm -f "$P"/python "$P"/python.bat "$P"/python.exe "$P"/python_cli_entry.mjs "$P"/*.d.ts "$P"/package.json
# resolve the dependency closure from the (checksummed) lock, fetch and verify each wheel
python3 - "$P/pyodide-lock.json" $PACKAGES > "$UP/wheels.txt" <<'PY'
import json, re, sys
lock = json.load(open(sys.argv[1])); pk = lock['packages']
norm = lambda s: re.sub(r'[-_.]+', '-', s).lower()
idx = {norm(k): k for k in pk}
seen, todo = set(), [idx[norm(n)] for n in sys.argv[2:]]
while todo:
    n = todo.pop()
    if n in seen: continue
    seen.add(n); todo += [idx[norm(d)] for d in pk[n]['depends']]
for n in sorted(seen):
    print(pk[n]['file_name'], pk[n]['sha256'], n)
PY
while read -r f sha _; do fetch "$PYODIDE_CDN/$f" "$DL/$f" "$sha"; cp "$DL/$f" "$P/"; done < "$UP/wheels.txt"
# trim the lock to what we ship, so missing packages fail cleanly instead of 404ing
python3 - "$P/pyodide-lock.json" "$UP/wheels.txt" <<'PY'
import json, sys
lock = json.load(open(sys.argv[1]))
keep = {l.split()[2] for l in open(sys.argv[2]) if l.strip()}
lock['packages'] = {k: v for k, v in lock['packages'].items() if k in keep}
json.dump(lock, open(sys.argv[1], 'w'), separators=(',', ':'))
PY
fetch "$COMM_URL" "$DL/$COMM_WHL" "$COMM_SHA" && cp "$DL/$COMM_WHL" "$LITE/pypi/"
# piplite records the wheel mtime as upload_time: pin it so the index is reproducible
touch -d "2025-07-25 00:00:00 UTC" "$LITE/pypi/$COMM_WHL"

# 4. jupyter lite build
rm -rf "$OUT"
( cd "$LITE" && jupyter lite build --lite-dir "$LITE" --output-dir "$OUT" >"$UP/lite-build.log" 2>&1 ) \
  || { tail -30 "$UP/lite-build.log"; exit 1; }

# 5. patches for running under /jupyter/ on a ship
python3 - "$OUT" <<'PY'
import glob, json, os, re, sys
out = sys.argv[1]
def rw(f, fn):
    s = open(f, encoding='utf-8').read(); t = fn(s)
    if t != s: open(f, 'w', encoding='utf-8').write(t)
    return t != s
# service worker heartbeat: the app fetches it from the origin root (/api/...);
# fetch it under the base url, and let the worker answer it under any prefix
n = 0
for f in glob.glob(os.path.join(out, 'build', '*.js')):
    s = open(f, encoding='utf-8').read()
    if 'fetch("/api/service-worker-heartbeat")' not in s: continue
    m = re.search(r'new URL\(null!=\(t=e\.workerUrl\)\?t:(\w+)\.URLExt\.join\(\1\.PageConfig\.getBaseUrl\(\)', s)
    if not m: sys.exit('heartbeat patch: coreutils alias not found in ' + f)
    c = m.group(1)
    n += rw(f, lambda s: s.replace('fetch("/api/service-worker-heartbeat")',
        f'fetch({c}.URLExt.join({c}.PageConfig.getBaseUrl(),"api/service-worker-heartbeat"))'))
n += rw(os.path.join(out, 'service-worker.js'), lambda s: s.replace(
    '"/api/service-worker-heartbeat"===a.pathname', 'a.pathname.endsWith("/api/service-worker-heartbeat")'))
if n != 2: sys.exit(f'heartbeat patch applied to {n} files, expected 2')
# manifest: drop stale icons and shortcuts (kit/pwa.py adds 192/512 from icon.svg)
m = os.path.join(out, 'manifest.webmanifest')
man = json.load(open(m))
man.pop('shortcuts', None); man['icons'] = []
man['name'] = man['short_name'] = 'JupyterLite'
json.dump(man, open(m, 'w'), indent=1)
# app pages: favicon link (no /favicon.ico probe) and a credentialed manifest fetch
def page(s):
    s = re.sub(r'<link rel="manifest" href="([^"]+)">', r'<link rel="manifest" href="\1" crossorigin="use-credentials">', s)
    if 'rel="icon"' not in s:
        s = s.replace('<link rel="manifest"', '<link rel="icon" href="../lab/favicon.ico">\n    <link rel="manifest"', 1)
    return s
for f in glob.glob(os.path.join(out, '*', 'index.html')):
    rw(f, page)
# /jupyter/ itself runs the lab app instead of redirecting to /jupyter/lab/
# (an installed PWA starts at its scope root, and the redirect is pointless)
lab = open(os.path.join(out, 'lab', 'index.html'), encoding='utf-8').read()
labcfg = json.load(open(os.path.join(out, 'lab', 'jupyter-lite.json')))['jupyter-config-data']
cfg = {**labcfg, 'appUrl': './lab', 'settingsUrl': './build/schemas'}
root = lab.replace('data-jupyter-lite-root=".."', 'data-jupyter-lite-root="."')
root = root.replace('href="../', 'href="./').replace("'../config-utils.js", "'./config-utils.js")
root, k = re.subn(r'(<script id="jupyter-config-data" type="application/json" data-jupyter-lite-root="\.">)\s*\{\}',
                  lambda m: m.group(1) + '\n      ' + json.dumps(cfg), root)
if k != 1 or '"../' in root or "'../" in root: sys.exit('root index: unexpected lab/index.html layout')
root = root.replace('</head>', '  <!-- the app calls navigator.serviceWorker.register for ./service-worker.js (scope ./) -->\n  </head>', 1)
open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(root)
if not rw(os.path.join(out, 'config-utils.js'), lambda s: s.replace(
        'if (config.baseUrl === new URL(here()).pathname) {',
        'if (config.baseUrl === new URL(here()).pathname && !document.getElementById(LITE_MAIN)) {')):
    sys.exit('config-utils.js patch failed')
PY
# drop files we don't serve (sourcemaps, licenses API stays)
find "$OUT" -name '*.map' -delete
find "$OUT" -name '*.d.ts' -delete
rm -f "$OUT"/rspack.config*.js
# sanity: nothing may point at a CDN at runtime
if grep -rlE 'cdn\.jsdelivr\.net/pyodide' "$OUT/jupyter-lite.json" "$OUT"/*/jupyter-lite.json 2>/dev/null; then
  echo "jupyter-lite.json still points at the pyodide CDN" >&2; exit 1
fi

# 6. desk/web
rm -rf "$HERE/desk/web" && cp -r "$OUT" "$HERE/desk/web"
find "$HERE/desk/web" -name '.*' -prune -exec rm -rf {} +
cp "$HERE/icon.svg" "$HERE/desk/web/icon.svg"
python3 "$KIT/pwa.py" "$HERE/desk"
python3 "$KIT/claysafe.py" "$HERE/desk/web"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
