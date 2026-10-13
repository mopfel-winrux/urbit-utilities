# kiwix: kiwix-js offline ZIM reader

- Upstream: https://github.com/kiwix/kiwix-js, release tag `4.4.0` (2026-08-22),
  tarball `https://github.com/kiwix/kiwix-js/archive/refs/tags/4.4.0.tar.gz`,
  sha256 `00dc3c6a7284dd5264c43376bbb77a402e67552ad741e604e8765f2c2f356bf1` (checked by build.sh).
- License: GPL-3.0-or-later (kiwix-js; `LICENSE-GPLv3.txt` ships in `web/`). Bundled
  third-party code keeps its own licences (listed in the app's About page): Bootstrap and
  Font Awesome (MIT / CC-BY-4.0 / SIL OFL), libzim wasm (GPL-2.0+), xz and zstd decoders
  (public domain / BSD), webp-hero (MIT), the Replay worker from webrecorder (AGPL-3.0).
- Build: `./build.sh` downloads the tarball into `upstream/` (gitignored), re-extracts it every
  run, copies `ship.js` into `www/js/`, applies `patch.py` (exact-match string edits that fail
  loudly if upstream changes), runs `npm ci` from upstream's lockfile and `npm run build-min`
  (rollup), copies `dist/` to `desk/web`, then `kit/pwa.py`, `kit/claysafe.py`, `kit/marks.py`,
  `kit/check.py`. Node 22 is required.

## What was patched (patch.py)

- No external requests: the app CSP is locked to `'self' data: blob: about:` (upstream allowed
  `*.kiwix.org`, `kiwix.github.io`, `ftp.fau.de`), as is the CSP injected into articles in
  Restricted mode and the library iframe page. Article content in a ZIM therefore cannot reach
  the internet either.
- Online ZIM library disabled: the "Browse ZIM Library" button is hidden, its handler no
  longer loads the catalogue, and `libraryUrl`, `altLibraryUrl`, `altLibraryProbe`, the mirror
  list and `PWAServer` (browser-extension redirect) are blanked. The upstream "update check"
  only compares local Cache API keys, so it makes no network request and is left as is.
  Remaining `https://` links in the About page are ordinary links the user may click.
- `window.setLocalArchiveFromFileList` is exposed so `ship.js` can hand kiwix-js a `File`.
- A "ZIM archives on your ship" card is added at the top of Configuration (`ship.js`).
- Service worker: never caches a redirected response (a login redirect after the session
  expires), precaches `manifest.webmanifest` and `ship.js` instead of the extension manifest
  and the dropped css sourcemap.
- build.sh: the web root `index.html` is a redirect to `www/index.html` (kiwix-js derives its
  paths from `/www/`), and links the manifest; extension manifests, docs and the sourcemap are
  dropped; the manifest is renamed "Kiwix" and normalized by `kit/pwa.py`.

## Storage on the ship

`ship.js` uses the hub store (same origin, login cookie):

| action | request |
|---|---|
| list | `GET /utilities/api/store/kiwix/` (shows rows whose `path` ends in `.zim`) |
| upload | `PUT /utilities/api/store/kiwix/<name>.zim`, body = file bytes, `content-type: application/octet-stream` |
| open | `GET /utilities/api/store/kiwix/<name>.zim` with `Range`, lazily: `ship.js` hands kiwix-js a File-like object whose `slice(a, b).arrayBuffer()` fetches only those bytes (64 kB blocks, 32 MB LRU cache) |
| delete | `DELETE /utilities/api/store/kiwix/<name>.zim` |

Local ZIMs still open through the normal kiwix-js file picker or drag and drop (File API).

## Service worker vs Restricted mode

kiwix-js defaults to ServiceWorker mode: `/kiwix/service-worker.js`, scope `/kiwix/`, which
serves articles at `/kiwix/<zim-name>/C/<path>` straight from the archive. Service workers
need a secure context (HTTPS or localhost). On a ship reached over plain HTTP at another
host name the app falls back to Restricted (jQuery) mode, which injects article HTML into the
page (no scripts in articles; fine for Wikipedia-style ZIMs, not for Zimit ZIMs). Both modes are
tested. When opening an archive in ServiceWorker mode kiwix-js asks once per file name whether
the source is trusted ("Trust Source" / "Open in Restricted Mode").

## Size

`desk/web`: 53 files, 10.3 MB. Largest: `www/js/libzim-asm.js` 4.2 MB (asm.js fallback for
browsers without WebAssembly, only used when libzim is selected in Expert settings),
`libzim-wasm.wasm` 2.2 MB, `bundle.min.js` 1.6 MB, `replayWorker.js` 1.1 MB.

## Sample

`samples/urbit-sample.zim` (60 KB, sha256 `90097b36…81300`) was written for this repo by
`samples/make-sample.py` (python-libzim 3.13.1) and is released under CC0-1.0. It has a main
page and two articles (Moon, Comet). Upstream test ZIMs were not used: zim-testing-suite has no
licence file and the single-file ones in kiwix-js's tests are larger.

## Test

`node test.js` (env `BASE_URL`, default `http://localhost:8207`, `SHIP_CODE`, `CHROME`; set
`RESTRICTED=1` to exercise Restricted mode): logs in at `/~/login`, deletes any old copy, uploads
the sample through the "Upload ZIM to ship" input (PUT), checks the store listing has the right
size, reloads, clicks "Open" for it (GET whole file), answers the trust prompt, waits for the
main page to render in the article iframe, follows the in-article "Moon" link and checks the
article text. It fails on page errors, any 4xx/5xx or failed request to the ship, and any
request to another origin. Result against the mock (kit/serve.py): PASS in both modes.
`kit/pwa-check.js kiwix`: `sw scope=/kiwix/ manifest=/kiwix/manifest.webmanifest errors=[]`.

## Limitations

- ZIMs on the ship are read on demand with Range requests. Opening a 21 MB test ZIM and
  rendering two articles read 192 kB in 3 requests (`ZIM=<path> node test.js` reports this).
  The upload is still one PUT of the whole file, so storing multi-GB ZIMs on a ship is
  probably not realistic anyway.
- Full-text search (libzim worker) most likely doesn't work for ZIMs opened from the ship
  (not tested): the worker needs a real `File` it can receive via postMessage, and kiwix-js
  catches that failure and carries on. Title search and articles work.
- Split archives (`.zimaa`, `.zimab`, ...) open from the computer but not from the ship list.
- The online library (downloading ZIMs from kiwix.org) is intentionally disabled.
