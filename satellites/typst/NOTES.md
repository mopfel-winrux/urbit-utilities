# Typst on Urbit (`%typst`)

The official typst.app editor is closed source. This desk packages
**Typst Online Editor** (https://github.com/Mapaor/typst-online-editor), a Next.js app that compiles
Typst entirely in the browser with typst.ts (`@myriaddreamin/typst.ts` 0.7.0-rc2, wasm compiler
with Typst 0.14) and previews the PDF with pdf.js. It has a file explorer with multi-file projects
stored in the browser, images and custom fonts, examples, PDF download.

- Upstream: https://github.com/Mapaor/typst-online-editor, commit `55b0c17322b6986ad27030bcbf220c3af9eed2af`
  (2026-01-05; the repo has no tags)
- License: MIT (app); typst.ts and Typst are Apache-2.0; fonts are SIL OFL (IBM Plex, Noto, Libertinus,
  New Computer Modern) and the DejaVu fonts license.
- Build: `./build.sh` (npm ci, Node 22). Resets `upstream/` to the commit, applies `patches/urbit.patch`,
  downloads typst-assets v0.14.2 (the version compiled into the wasm) and checks every font against
  `fonts.sha256`, checks upstream's bundled fonts against `upstream-fonts.sha256`, copies the wasm compiler
  and pdf.js worker from the locked npm packages, runs `next build` as a static export with
  `NEXT_PUBLIC_BASE_PATH=/typst` (and `NEXT_TELEMETRY_DISABLED=1`), copies `out/` to `desk/web`, then runs
  the kit pwa/claysafe/marks/check. The kit service worker is installed. `icon.svg` is our own.
- Size of `desk/web`: about 113 MB (392 files): wasm compiler 28 MB, Noto Color Emoji 25 MB and
  Noto Sans CJK SC 33 MB (both only fetched when a document contains emoji / CJK text), Typst's
  default fonts about 8 MB.
- Desk config: `spa=|` (single page at `/typst/`), `auth=&`.
- `kit/marks.py`: added `typ` (text/plain) for the bundled example `.typ` files.

## Patches (`patches/urbit.patch`)
- `next.config.ts`: `output: "export"`, `basePath` from `NEXT_PUBLIC_BASE_PATH`, unoptimized images,
  no browser source maps.
- `src/lib/typst/typst.worker.ts`: all fonts served from `/typst/fonts/` (base path was missing for
  fonts); core fonts are Typst's defaults (Libertinus Serif, New Computer Modern, New CM Math,
  DejaVu Sans Mono) plus IBM Plex Sans; `loadFonts(..., { assets: false })` so typst.ts does not
  fetch its default font set from cdn.jsdelivr.net.
- `src/lib/pdf/pdfjs.ts`: pdf.js worker from `/typst/pdfjs/pdf.worker.min.mjs` instead of jsdelivr.

## Tested (`test.js`, mock ship on :8204)
Logs in via `/~/login`, opens `/typst/`, replaces the document with a heading and inline/display math,
clicks "Compile Now", waits until the pdf.js preview text layer shows the heading, clicks
"Download PDF" and checks that the file starts with `%PDF-`. Also fails if the page makes any request
outside the ship, on page errors, or on 4xx/5xx from the ship. Passes (the PDF embeds
LibertinusSerif and NewCMMath). `kit/pwa-check.js typst`: `errors=[]`.

## External connections that remain
- Only when a document imports a Typst Universe package (`#import "@preview/..."`, e.g. the bundled
  "mitex" example): typst.ts downloads it from `packages.typst.org`. Nothing else.

## Known issues
- First compile downloads the 28 MB wasm and about 8 MB of fonts (cached afterwards by the service worker).
- Projects live in the browser's storage (per browser, not on the ship).
