# FossFLOW satellite

- Upstream: the Umbrel store's FossFLOW (`github.com/stan-smith/FossFLOW`, docker image `stnsmith/fossflow:master-b69fc2e`) — that repository no longer exists (404). We build the maintained continuation https://github.com/Abrar74774/FossFLOW ("A continuation of stan-smith/FossFLOW"), which carries the full original history including `b69fc2e`, the commit the Umbrel store ships. Pinned to tag `v1.0.5` (commit `5846189cda7013eb0f810da7eb4bdf02648fbbc7`).
- License: MIT (Copyright Mark Mankarious, isoflow; FossFLOW contributors)
- Build: `build.sh` clones, checks out the commit, applies `patches/urbit.patch`, `npm ci`, builds the `fossflow` lib then the app with rsbuild and `PUBLIC_URL=/fossflow/` (node 24, required by `engines`).
- `desk/web`: 11 MB, 35 files. History routing (`/fossflow/display/<id>`), so the desk uses `spa=&`.

## Patches (`patches/urbit.patch`)
- `storageService.ts`: server storage is never probed (no `/api/storage/status` request, which would 404 on the ship); the app uses browser session storage plus JSON import/export only.
- `index.tsx`: the app's own service worker is not registered. Upstream's worker precaches files that don't exist in the rsbuild output (`static/js/bundle.js`) and caches any 200 response, including login pages. `kit/pwa.py` installs the kit worker instead; `service-worker.js` is removed from the output.
- `i18n.ts`: `load: 'currentOnly'`, so i18next doesn't request `i18n/app/en.json` (only `en-US.json` etc. exist; was a 404).
- `build.sh` copies `logo512.png` as `icon.png` and drops `*.LICENSE.txt` and `robots.txt`.

## PWA
`kit/pwa.py` rewrites `manifest.json` (scope/start_url `/fossflow/`) and installs `sw.js`. `kit/pwa-check.js fossflow` -> `errors=[]`.

## Tested (`test.js`)
Opens "Add item", drags the first icon (`block`) onto the canvas, exports via "Export File" > "Download JSON" and checks the JSON has one item placed in the view. No page errors, failed/4xx ship requests or external requests.

## Known issues
- Server storage and the read-only share links (`/display/<id>`) need the FossFLOW backend, which isn't shipped; they're hidden/unused.
- Icon packs are bundled (lazy-loaded chunks), nothing is fetched from isoflow.io.
