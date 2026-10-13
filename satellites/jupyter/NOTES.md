# jupyter: JupyterLite on the ship

JupyterLab running entirely in the browser with a Pyodide (CPython on
WebAssembly) kernel. Notebooks and files live in the ship's `%utilities` store,
not in browser storage.

## Upstream, versions, licenses

| what | version | source | license |
|---|---|---|---|
| JupyterLite (`jupyterlite-core`, app = JupyterLab 4.6.4) | 0.8.6 | https://github.com/jupyterlite/jupyterlite (PyPI) | BSD-3-Clause |
| `jupyterlite-pyodide-kernel` | 0.8.6 | https://github.com/jupyterlite/pyodide-kernel (PyPI) | BSD-3-Clause |
| Pyodide core | 314.0.6 (Python 3.14.2) | https://github.com/pyodide/pyodide/releases/download/314.0.6/pyodide-core-314.0.6.tar.bz2, sha256 pinned in `build.sh` | MPL-2.0 |
| Pyodide packages | from the 314.0.6 lock | https://cdn.jsdelivr.net/pyodide/v314.0.6/full/ (build time only), each wheel checked against the sha256 in `pyodide-lock.json` | their own (numpy, pandas, matplotlib, ipython, jedi: BSD; matplotlib: PSF-style; pillow: MIT-CMU, ...) |
| `comm` wheel (piplite) | 0.2.3 | PyPI, sha256 pinned | BSD-3-Clause |
| `jupyter-builder` (builds the extension) | 1.2.3 | PyPI / npm `@jupyter/builder` 1.2.3 | BSD-3-Clause |
| `ship-drive/` (ours) | 0.1.0 | this repo | MIT |

Vendored Pyodide packages (closure of micropip, packaging, ipython, jedi, numpy,
pandas, matplotlib): asttokens, contourpy, cycler, decorator, executing,
fonttools, ipython 9.12, jedi, kiwisolver, matplotlib 3.10.8,
matplotlib-inline, micropip, numpy 2.4.6, packaging, pandas 3.0.2, parso,
pillow, prompt-toolkit, pure-eval, pygments, pyparsing, python-dateutil, pytz,
six, stack-data, traitlets, wcwidth. `pyodide-lock.json` is trimmed to exactly
these, so anything else fails cleanly ("no known package") instead of 404ing.

## Build

`./build.sh` (set `JUPYTER_VENV=<dir>` to put the Python venv elsewhere; the
default is `upstream/venv`). Everything below is pinned and checksummed and the
output is byte-identical between runs.

1. venv with `jupyterlite-core`, `jupyterlite-pyodide-kernel`, `jupyter-builder`.
2. Builds `ship-drive/` (a prebuilt JupyterLab extension, plain ES module, no
   TypeScript) with `jupyter-builder build` and installs it into the venv's
   `share/jupyter/labextensions`, where `jupyter lite build` picks it up.
3. Lite dir: `lite/jupyter-lite.json` (disables the IndexedDB default drive,
   turns off the PyPI fallback) and `lite/jupyter_lite_config.json` (lab app
   only, no sourcemaps). Pyodide core is unpacked into `static/pyodide`
   (`jupyter lite build` then points `pyodideUrl` at `./static/pyodide/pyodide.mjs`
   instead of the jsDelivr CDN), plus the wheels above; `comm` goes into the
   piplite index (`pypi/`).
4. `jupyter lite build`, then patches (in `build.sh`):
   - `/jupyter/` runs the lab app itself instead of redirecting to
     `/jupyter/lab/` (the root `index.html` is generated from `lab/index.html`,
     and `config-utils.js` only redirects pages that have no app bundle). The
     PWA starts at its scope root, and `kit/pwa-check.js` needs a page that
     doesn't navigate away. `/jupyter/lab/` still works.
   - The service-worker heartbeat was fetched from the origin root
     (`/api/service-worker-heartbeat`). It's now fetched under the base URL and
     the worker answers it under any prefix.
   - Favicon links (no `/favicon.ico` probe) and `crossorigin="use-credentials"`
     on the manifest links. The manifest's stale icons and shortcuts are removed.
   - Sourcemaps, `.d.ts`, `rspack.config*.js` and Pyodide's CLI files are
     removed.
5. `kit/pwa.py`, `kit/claysafe.py`, `kit/marks.py`, `kit/check.py`.

## Storage on the ship

`ship-drive` provides JupyterLab's `IDefaultDrive` and replaces
`@jupyterlite/services-extension:default-drive` (IndexedDB). It speaks WebDAV
to the hub on the same origin, under the desk's namespace:

| operation | request |
|---|---|
| list a directory / stat a path | `POST /utilities/dav/jupyter/<dir>/` + `X-HTTP-Method-Override: PROPFIND`, `Depth: 1` (a single path is looked up in its parent's listing, so probing a missing file isn't a 404) |
| open a file | `GET /utilities/dav/jupyter/<path>` |
| save / upload | `PUT /utilities/dav/jupyter/<path>` (notebooks as `application/x-ipynb+json`, indent 1), conditional (see below). Chunked uploads from the file browser are joined in memory and PUT once. |
| new folder | `MKCOL` (tunneled) |
| rename / move | `MOVE` (tunneled), `Destination: /utilities/dav/jupyter/<new>`, `Overwrite: F` |
| duplicate | `COPY` (tunneled) |
| delete | `DELETE /utilities/dav/jupyter/<path>` |
| download link | `/utilities/api/store/jupyter/<path>` |

### Save conflicts (ETags)

The hub gives every item a strong `ETag` (on GET, in the PUT response, and as
PROPFIND `getetag`; see "ETags, conditional requests and Range" in
`kit/CONTRACT.md`).

- The drive reports the ETag as the contents model's `hash`
  (`hash_algorithm: "etag"`). JupyterLab 4.6's document context loads with
  `hash: true`. Before every save (manual or autosave) it stats the file with
  `hash: true` and compares the two. On a mismatch it shows its own **"File
  Changed"** dialog: Cancel / Revert (load the ship's version) / Overwrite. When
  both hashes are present, JupyterLab skips its `last_modified` check. That
  check only has one-second precision here (`getlastmodified` is RFC 1123, and
  the default margin is 500 ms), so a change within the same second is still
  caught. `last_modified` itself still comes from `getlastmodified`.
- The drive also remembers, per path, the tag of the version it last loaded or
  saved. It learns the tag from a content GET, from a PUT response, and from the
  context's `hash: true` stat (the version the user has just been asked about).
  It also remembers when a path is known not to exist. Every PUT is conditional
  on that:
  - `If-Match: <tag>` for a known file.
  - `If-None-Match: *` for a path known to be absent (new untitled files, and
    deleted or moved-away paths).
  - No condition only for a path the drive has never seen, such as a kernel
    write to a fresh file.

  So a write that lands between JupyterLab's check and the PUT gets `412`, and
  nothing is overwritten. The drive turns the 412 into an error that JupyterLab
  shows as **"File Save Error for <name>"**: "... was changed on the ship by
  someone else after it was loaded here, so it was not overwritten. Save again
  to choose between overwriting it ... and reverting ...". The next save then
  gets the "File Changed" dialog, because the document's hash is still the old
  one. Its Overwrite sends `If-Match` with the tag that the stat saw.
- MOVE carries the remembered tags to the new path (including everything under
  a moved folder), and the old path becomes "absent". DELETE marks the path
  absent. COPY targets are looked up fresh. "Revert to checkpoint" is an
  explicit overwrite and PUTs without a condition.
- If the hub sends no ETag (an older hub), nothing is conditional, and
  JupyterLab falls back to its `last_modified` check.

The overrides are set by the drive itself, so `kit/shim.js` isn't needed. The
same items appear in `GET /utilities/api/store/jupyter/` (a notebook saved as
`a.ipynb` is `/utilities/api/store/jupyter/a.ipynb`).

The Pyodide kernel's working directory is `/drive`, which JupyterLite backs with
the contents manager through its service worker. So `open('x.csv')` and
`df.to_csv('out.csv')` in a notebook read and write the ship store too (verified:
a file written from the kernel appeared in `/utilities/api/store/jupyter/`).

Still in the browser (IndexedDB, per browser): JupyterLab settings, the
workspace layout, and checkpoints (in memory, for the session).

## Size

`desk/web`: 498 files, 53.8 MB. Pyodide is 34 MB of that (wasm 9.6 MB,
matplotlib 7.0 MB, pandas 4.2 MB, numpy 2.9 MB, stdlib 2.5 MB). The rest is
JupyterLab.

## Tested

`test.js` against the mock (`python3 kit/serve.py --port 8243`, then
`BASE_URL=http://localhost:8243 node test.js`): PASS in about 35 s
(2026-10-13, with the conflict steps). Steps: log
in, open `/jupyter/`, create a notebook from the launcher, wait for the Pyodide
kernel, run `import numpy; print(numpy.arange(3).sum())` and check the output is
`3`. Then Ctrl+S (JupyterLab asks to rename the untitled notebook, and the test
names it `ship-test-<ts>.ipynb`). It checks that `GET /utilities/api/store/jupyter/`
lists the notebook and that the stored JSON has output `3`. Then it opens a fresh
browser profile (no IndexedDB, no service worker), finds the notebook in the file
browser, opens it, checks the code and output, waits for the kernel, and deletes
the test notebook. In between, it tests conflicts on the saved
notebook:

1. "Another writer" does a `fetch` PUT that adds a marker in
   `metadata.other_writer`. The test edits the notebook and presses Ctrl+S.
   JupyterLab's "File Changed" dialog must appear, and the store must still
   hold the other version. Overwrite must store ours, with `If-Match` on the
   PUT.
2. Puppeteer holds JupyterLite's save PUT while Node writes the notebook with
   the page's cookies. This is a write that races the save after JupyterLab's
   check. The PUT must get 412, the "File Save Error" dialog must show the
   drive's message, and the store must keep the other version. Then Ctrl+S
   gives "File Changed", Revert loads the other version, and a further edit and
   save goes through without a dialog.

It also checks that the new-notebook PUT is `If-None-Match: *`. It fails on page errors, on any 4xx/5xx or failed request to
the ship, and on any request to another origin.

Also checked by hand: pandas, matplotlib (`plt.show()` renders a PNG) and
kernel file I/O to the store. `node kit/pwa-check.js jupyter` gives:
`sw scope=http://localhost:8243/jupyter/ ... errors=[]`.

## Limitations

- Only the packages listed above are available offline; the PyPI fallback is
  off. `%pip install` of anything else fails (no external requests). To add one,
  put it in `PACKAGES` in `build.sh` (from the Pyodide lock) or add a pure-Python
  wheel to the piplite index (`$LITE/pypi` in `build.sh`). `tzdata` isn't vendored, so time-zone
  names that need it won't resolve in pandas.
- Range requests: none needed. Whole files are fetched, which is fine for
  notebooks. Opening very large data files from the store loads them fully
  into memory (the kernel's `/drive` reads whole files through the contents
  API).
- No real-time collaboration, no terminals. Checkpoints ("Revert to
  checkpoint") last only for the browser session.
- The JupyterLite service worker runs without caching (`enableCache=false`), so
  it never caches login redirects, but the app doesn't work offline.
- The browser console shows `WebSocket connection to 'ws://.../jupyter/api/kernels/...' failed`
  while the kernel starts. These come from JupyterLite's in-page mock socket
  (`mock-socket`). No network request is made, and it's harmless.
- When the drive's PUT gets a 412, the console shows an unhandled rejection.
  This is upstream behaviour: JupyterLab's save command rethrows every failed
  save after showing its error dialog. `test.js` allows exactly that page error
  in the race step.
- The drive's 412 can only produce JupyterLab's generic "File Save Error"
  dialog (with the explanation). The Overwrite / Revert choice comes on the next
  save. JupyterLab's own pre-save check catches every conflict except one that
  races the save itself, so in practice users see the "File Changed" dialog.
- After a successful save, JupyterLab stats the file again and adopts that tag.
  A write that lands in the instant between our PUT and that stat would be
  adopted without a dialog. This window is in JupyterLab, not in the drive.
- Contract: nothing missing. One kit bug: `kit/new-satellite.sh` left a literal
  `AUTH` in `app/fileserver/config.hoon` (the sed `&`), fixed here by hand to `&`.
