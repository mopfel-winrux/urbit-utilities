# omni-tools

- Upstream: https://github.com/iib0011/omni-tools, tag `v0.6.0` (commit `922b28ce154e8f22da4a721472889717a95f7562`)
- License: MIT. Bundled runtime assets with their own licenses: ffmpeg.wasm core (GPL-2.0-or-later
  build of FFmpeg, from `@ffmpeg/core` 0.12.10), Ghostscript WASM (AGPL-3.0, from
  laurentmmeyer/ghostscript-pdf-compress.wasm), `@imgly/background-removal` and its model data
  (AGPL-3.0), tesseract.js (Apache-2.0), Monaco editor (MIT), Iconify icon data (per icon set,
  mostly Apache-2.0, MIT or OFL).
- `desk/web`: about 460 files, 215 MB. The big parts are the background-removal model and
  onnxruntime (100 MB), ffmpeg core (32 MB), an unused onnxruntime WebGPU wasm that Vite emits
  (24 MB), Ghostscript (14 MB), tesseract (about 40 MB with 12 languages) and Monaco (about 15 MB).
- History routing: the desk is scaffolded with `spa=&`, so deep links such as `/omni-tools/video/flip` work.

## Build (`build.sh`)
- Clones the tag, applies `patches/urbit.patch` and runs `npm ci` (the Dockerfile uses package-lock).
- Generates `src/iconify-offline-data.ts` with `scripts/offline-icons.mjs`: every `prefix:name` icon
  used in `src/` (107 icons from 26 sets), taken from a pinned `@iconify/json` 2.2.542 tarball
  (sha512 checked). Otherwise `@iconify/react` fetches every icon from api.iconify.design.
- `tsc` then `vite build` with `base: '/omni-tools/'`, no source maps.
- Vendors these into `desk/web`:
  - `ffmpeg/`: `@ffmpeg/core` ESM core and wasm from node_modules (lockfile-pinned).
  - `gs-worker.wasm`: from GitHub at a pinned commit, with a pinned sha256. It is byte-identical
    to the file upstream loads from cdn-wasm.b-cdn.net.
  - `tesseract/`: worker and LSTM cores from node_modules, plus `4.0.0_best_int` data for the
    12 languages the OCR tool offers (`@tesseract.js-data/*` tarballs, sha512 pinned).
  - `monaco/vs`: monaco-editor 0.52.2 `min/vs`, the version `@monaco-editor/loader` loads by
    default (tarball sha512 pinned). The repo's 0.53 devDependency fails with AMD (`getModel` errors).
  - `imgly/`: `resources.json` (sha256 pinned) and the chunks for the default `isnet_fp16` model
    and the CPU onnxruntime. Each chunk is checked against its sha256 name and stored as `<hash>.bin`,
    because Clay needs an extension; `resources.json` is rewritten to match.
  - `browser-image-compression.js`: the image-compression worker script, from node_modules.
- Runs `kit/pwa.py` (no own service worker, so the kit's `sw.js` is installed), then claysafe,
  marks and check.

## Patches (`patches/urbit.patch`)
- `vite.config.ts`: `base: '/omni-tools/'`, no source maps. `App.tsx`: router `basename`.
  The i18n `loadPath` and the home page background use the base path.
- All 16 ffmpeg tools load the vendored core through `src/lib/ffmpeg-core.ts` (upstream used
  jsdelivr, or unpkg defaults when no URL was given).
- `gs-worker.js` loads `<base>gs-worker.wasm`.
- `lib/ghostscript/worker-init.ts`: the result is a `blob:` URL created in the worker, and
  terminating the worker revoked it, so Compress PDF hung with ERR_FILE_NOT_FOUND. The result is
  now copied into a page-owned blob before the worker is terminated. This is an upstream bug.
- Background removal, OCR, Monaco and browser-image-compression point at the vendored paths.
- Image editor (filerobot): `useBackendTranslations={false}` (the default fetched and POSTed
  translations to ultrafast.io and wordplex.io).
- Removed the ghbtns.com GitHub-stars iframe from the navbar.
- PDF Editor tool removed from the list: it embeds the third-party simplePDF.com editor in an
  iframe and can't work offline.
- `src/iconify-offline.ts` (imported first in `index.tsx`) registers the bundled icons and
  blocks API lookups for those sets. `site.webmanifest` uses relative URLs.

## Tested
- `test.js`: logs in, opens `/omni-tools/`, clicks Video, then Flip video, reloads the deep link,
  uploads `samples/sample.mp4` (4.3 MB) and waits for ffmpeg.wasm to finish. It downloads the
  result and checks that it is a new MP4 (`ftyp`, 8.9 MB). Fails on page errors, failed or
  4xx/5xx requests to the ship, and any request to another origin.
- `kit/pwa-check.js omni-tools` gives `errors=[]` (kit worker, scope `/omni-tools/`).
- Crawled all 108 tool pages: no page errors and no external, failed or 4xx requests.
  Checked by hand that these produce a result with only local requests: Compress PDF
  (Ghostscript), image to text (tesseract), image compress (worker), remove background
  (imgly model) and JSON prettify (Monaco).

## Known issues
- The PDF Editor tool is removed (third-party service).
- The "Hire me" (Google Drive) and Discord buttons are ordinary outbound links.
- Vite still emits onnxruntime's WebGPU (`jsep`) wasm, 24 MB, which is never loaded
  (background removal runs on the CPU with its own vendored runtime).
