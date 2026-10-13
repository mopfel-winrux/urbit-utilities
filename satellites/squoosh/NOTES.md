# Squoosh satellite

- Upstream: https://github.com/GoogleChromeLabs/squoosh, branch `dev` at commit `e8d35e0fb66eb16eff6fe8fc773eabcbb7128de3` (2024-08-19, the code squoosh.app serves; the last tag `v1.12.0` is the 2020 v1 app).
- License: Apache-2.0
- Build: `build.sh` clones, checks out the commit, applies `patches/urbit.patch`, `npm ci --ignore-scripts`, `npm run build` (rollup). It builds fine on node 22 (`.nvmrc` says 20.16); the codec `.wasm` files are the prebuilt ones committed in `codecs/`, nothing is compiled with emscripten/rust.
- `desk/web`: 26 MB, 80 files (23 wasm codecs, 3 demo images ~8 MB).

## Patches (`patches/urbit.patch`)
- Base path `/squoosh/`: `lib/entry-data-plugin.js` (all chunk/asset URLs), manifest link and "back" link in the static page, manifest `start_url`/share-target action, editor route (`/squoosh/editor`), and the service worker's routes, shell URL, demo-image cache prefix and cache cleanup.
- Service worker: the dynamic (demo image) cache only stores `ok`, non-redirected responses. The precache uses `cache.addAll`, which rejects non-ok responses.
- Google Analytics removed (`ga()` is a no-op, `analytics.js` is never loaded).
- `build.sh` drops `_headers`/`_redirects` (Netlify), the `og:image` and canonical tags, and uses the maskable app icon as `icon.png`.

## PWA
Squoosh's own worker (`/squoosh/serviceworker.js`, scope `/squoosh/`) is kept; `kit/pwa.py` only normalizes the manifest and adds 192/512 icons. `kit/pwa-check.js squoosh` -> `errors=[]`. The desk uses `spa=&` so reloading `/squoosh/editor` works before the worker is installed.

## Tested (`test.js`)
Loads a generated 640x480 noisy PNG (~615 KB), sets the left pane to WebP and the right pane to MozJPEG, and checks both outputs from the app's download links: WebP ~54 KB (8.7%), MozJPEG ~31 KB (5.1%), both 640x480. No page errors, failed/4xx ship requests or external requests.

## Known issues
- The ship doesn't send COOP/COEP headers, so the page isn't cross-origin isolated: the multi-threaded AVIF/JXL/WP2/oxipng encoders fall back to their single-threaded builds (slower, same output).
