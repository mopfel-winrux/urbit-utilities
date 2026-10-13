# vert: VERT file converter

- Upstream: https://github.com/VERT-sh/VERT (built from `f5ecdec`). All
  conversions run in the browser (WebAssembly); the ship only serves files.
- License: AGPL-3.0. The patches in `patches/urbit.patch` are under the same
  licence.

## Patches to VERT (`patches/urbit.patch`)

- `paths.base = "/vert"` (override with `VERT_BASE`), with every
  root-relative URL routed through it: `src/lib/util/base.ts`, navbar,
  links, goto, the service worker and the manifest.
- `vite.config.ts`: a `vert:clay-filenames` plugin. Clay paths only allow
  `[a-z0-9-._~]`, so hashes are hex and `[name]` is lowercased, for the main
  bundle and the workers.
- The ffmpeg core is vendored to `static/ffmpeg/` (`build.sh` fetches
  `@ffmpeg/core@0.12.10`) instead of loading from cdn.jsdelivr.net.
- `.env`: `PUB_DISABLE_ALL_EXTERNAL_REQUESTS=true` (no vertd, Stripe or
  Plausible). Also fixed `useVertdSizeLimit`, which probed vertd anyway.
- Dropped `static/VERT_Feature.webp` and `sitemap.xml` (only used by
  vert.sh, and the first has an uppercase name).

## Doesn't work

- Server-side conversions via vertd (video conversions through vertd's GPU
  backend). Everything else converts in the browser.

## Test

`test.js` runs `test/e2e.js`. It logs in, then converts md to docx, md to
html, png to webp, png to jpg, wav to mp3 and mp4 to webm through the UI, and
checks each download. `CASES=png:webp` limits the run.
