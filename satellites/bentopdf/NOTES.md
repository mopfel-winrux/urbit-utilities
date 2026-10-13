# bentopdf

- Upstream: https://github.com/alam00000/bentopdf, tag `v2.8.8` (commit `f96cd4e5166f3d51393dfe9f3c440b5bb77802f1`)
- License: AGPL-3.0-only. Vendored runtime packages: PyMuPDF WASM and Ghostscript WASM
  (AGPL-3.0-only), coherentpdf (AGPL-3.0-or-later), tesseract.js / tesseract.js-core
  (Apache-2.0), tesseract language data (Apache-2.0), Noto fonts from `@embedpdf/fonts-*` (OFL-1.1).
- `desk/web`: about 1400 files, 267 MB. The big parts are LibreOffice WASM (77 MB),
  PyMuPDF/Pyodide (56 MB), pdf.js viewers (about 30 MB), Ghostscript (15.5 MB) and editor fonts (24 MB).

## Build (`build.sh`)
- Clones the tag, applies `patches/urbit.patch`, runs `npm ci`, `tsc` and `vite build` with
  `BASE_URL=/bentopdf/` and upstream's air-gap variables (`VITE_WASM_*_URL`,
  `VITE_TESSERACT_*`, `VITE_OCR_FONT_BASE_URL`, `VITE_EMBEDPDF_FONTS_URL`) pointing at
  `/bentopdf/wasm/...`, and with `DISABLE_GITHUB_STARS=true`.
- Vendors the packages upstream loads from cdn.jsdelivr.net (`npm pack`, each tarball checked
  against a pinned sha512) into `web/wasm/`, laid out like upstream's `scripts/prepare-airgap.sh`.
  OCR ships English, German, French and Spanish (`4.0.0_best_int`) and only the LSTM cores
  (the app always uses OEM 1).
- Drops the `.br`/`.gz` precompressed copies (except LibreOffice's, which the app gunzips
  itself), source maps, type declarations and test data. Extensionless license files get `.txt`.
- Strips an `@import` of Google Fonts (Open Sans) from the embedpdf viewer CSS.
- Skips upstream's per-language page copies (`/de/...`, 20 languages, 88 MB), the sitemap
  and the SEO audit.
- A shim at `wasm/gs/dist/index.js` lets PyMuPDF's pdf-to-docx RGB pass load Ghostscript from
  the same flat directory as the rest of the app (upstream's own CDN layout gets a 404 there).
- Then runs `kit/pwa.py`, adds `crossorigin="use-credentials"` to the manifest link on every
  tool page (pwa.py only fixes `index.html`), and runs claysafe, marks and check.

## Patches (`patches/urbit.patch`)
- `src/js/sw-register.ts`: register the service worker in every production build (upstream
  skipped it on localhost and on any non-default port, which is how ships are usually served).
  The page reloads once when the worker first takes control, so that it becomes cross-origin isolated.
- `public/sw.js`: the ship can't send COOP/COEP headers, and LibreOffice's threaded WASM
  needs `SharedArrayBuffer`. So the worker adds `Cross-Origin-Embedder-Policy: require-corp`,
  `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy` to every
  response in its scope (the coi-serviceworker approach). It never caches redirected
  responses (login redirects), matches the cache only by exact URL (upstream also matched by
  file name), only handles GETs under its scope, and its cache name changes on every build.
- `src/js/i18n/i18n.ts`: because the per-language page copies aren't shipped, switching
  language stays on the same page and applies the translation client-side from `locales/`.
  Links are no longer rewritten to `/<lang>/...`.
- `public/site.webmanifest`: relative `start_url` and icon paths.

## Tested
- `test.js`: logs in, opens `/bentopdf/`, waits for the service worker to make the page
  cross-origin isolated, follows the Merge PDF card, uploads `samples/a.pdf` (1 page) and
  `samples/b.pdf` (2 pages), clicks Merge, and checks the downloaded `merged.pdf` with the
  desk's own pdf.js: it has 3 pages. Fails on page errors, failed or 4xx/5xx requests to the
  ship, and any request to another origin.
- `kit/pwa-check.js bentopdf` gives `errors=[]` (the app's own worker, scope `/bentopdf/`).
- Checked by hand with a probe script, with no external, failed or 4xx requests: compress
  (PyMuPDF), PDF to DOCX (PyMuPDF and Ghostscript), OCR (tesseract, English) and Word to PDF
  (LibreOffice, after cross-origin isolation).

## Known issues
- Tools that use LibreOffice (Word, Excel, PowerPoint and other office formats to PDF) only work
  once the service worker controls the page. That happens on the first visit to `/bentopdf/`
  after one automatic reload. They fail in browsers without service workers, such as some
  private windows.
- The per-language URLs (`/bentopdf/de/...`) don't exist. The language switcher still works.
- OCR offers only eng, deu, fra and spa. Other languages would need their
  `@tesseract.js-data/<lang>` traineddata (and a script font for non-Latin languages).
- Digital signatures: optional timestamping (TSA, for example freetsa.org) and fetching
  certificate chains need the internet. The CORS proxy is disabled, so chain fetching
  from the browser may fail for some certificates.
- Outbound links (docs, GitHub, social media, hreflang alternates pointing at bentopdf.com)
  are ordinary links and are never fetched automatically.
