# mazanoke

- Upstream: https://github.com/civilblur/mazanoke, tag `v1.1.7` (commit `41d2ddfc1eda40f7d7c603754296b06982421287`)
- License: GPL-3.0-only (fonts: Geist / Geist Mono, OFL-1.1)
- Build: static site, no bundler. `build.sh` clones the tag, applies `patches/urbit.patch`,
  copies `index.html assets favicon.ico manifest.json` to `desk/web` (what upstream's
  Dockerfile serves), fills the footer version like `scripts/environment.common.js`,
  then runs `kit/pwa.py`, claysafe, marks and check.
- `desk/web`: 40 files, about 7.6 MB (most of it is the HEIC decoders).

## Patches (`patches/urbit.patch`)
- The browser-image-compression web worker loads its library from
  `${location.origin}/assets/vendor/...`, which is wrong under `/mazanoke/`
  (and its default would be cdn.jsdelivr.net). Now resolved against `document.baseURI`.
- The app's own service worker is not registered: it registered `/service-worker.js` at
  the ship root with absolute paths and cached redirected (login) responses. `kit/pwa.py`
  installs the kit worker as `/mazanoke/sw.js` instead. The app's "update available"
  toast therefore never shows. Its install button still works through `beforeinstallprompt`.
- `manifest.json`: link and its URLs made relative.

## Tested
`test.js`: logs in, opens `/mazanoke/`, picks WebP as output, uploads
`samples/sample.png` (1600x1200, 456 KB) and checks the result is a `.webp` with a
RIFF/WEBP header and smaller than the input (about 39 KB). Fails on page errors,
failed or 4xx/5xx requests to the ship and any request to another origin.

`kit/pwa-check.js mazanoke` gives `errors=[]` (kit worker, scope `/mazanoke/`).

## Known issues
- None found. No runtime network requests besides the desk's own files.
