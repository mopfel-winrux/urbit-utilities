# %office: LibreOffice in the browser

Writer, Calc and Impress, running fully in the browser as WebAssembly.
Documents are stored in the `%utilities` hub store on the ship.

## Upstream and versions

| component | source | version / pin | license |
|---|---|---|---|
| ZetaOffice (LibreOffice compiled to wasm, "LOWA") | `https://cdn.zetaoffice.net/zetaoffice_latest/` `soffice.{js,wasm,data,data.js.metadata}` | build of 2025-05-13 (LibreOffice `distro/allotropia/zeta-24-2`, emscripten 3.1.65 fork, Qt 5.15.2 wasm). Pinned by SHA-256 in `build.sh` | MPL-2.0, plus LibreOffice's bundled third-party licenses |
| zetajs | npm `zetajs@1.2.0` (https://github.com/allotropia/zetajs) | SHA-256 pinned | MIT |
| UI (`src/`) | this repo | | MIT |

Where to get the binaries:
- LibreOffice/TDF publishes no wasm binaries; `dev-builds.libreoffice.org` has
  none. Building upstream LOWA (`static/README.wasm.md`) means an Emscripten
  and Qt5 wasm toolchain and many hours of compiling, so we don't build it.
- allotropia publishes ZetaOffice builds on its CDN and explicitly supports
  self-hosting them (zetaoffice.net, "Self-Hosted or CDN").
- The CDN only has the unversioned `zetaoffice_latest/` directory, so
  `build.sh` pins the exact bytes by SHA-256. If allotropia replaces the
  build, the download fails the check. Then test the new build and update the
  sums, or keep the old files in `upstream/`.
- The CDN serves `soffice.wasm` and `soffice.data` with
  `Content-Encoding: br`. `curl --compressed` decodes them, and the sums are
  of the decoded files.

MPL-2.0 compliance: the files are unmodified. `web/licenses/` contains the
MPL-2.0 text, the zetajs MIT license and `readme.txt`, which says where the
corresponding source is (the four allotropia branches listed in the zetajs
README). LibreOffice's own third-party notices are in Help > About > License
inside the app.

## Build

`./build.sh` does the following:
1. Downloads into `upstream/` (gitignored) and verifies the files.
2. Gzips `soffice.wasm` (162 MB) and `soffice.data` (100 MB)
   deterministically (mtime 0, level 9) to 53.5 MB and 28.1 MB.
3. Copies `src/` plus the binaries and `zeta.js` into `desk/web`.
4. Runs `kit/pwa.py`, stamps the service worker cache version (a hash of the
   web files), then runs claysafe, marks and check.

Repeated builds give byte-identical output. I appended `metadata`
(`application/json`) to `kit/marks.py` for `soffice.data.js.metadata`.

Desk size: 16 files, 82.8 MB (`web/`). Unpacked in the browser it is 262 MB.

## Threads, COOP/COEP and the service worker

The build uses pthreads, so it needs `SharedArrayBuffer`. That requires a
cross-origin isolated page (COOP `same-origin` and COEP `require-corp`) in a
secure context. The Urbit fileserver can't send those headers, so `web/sw.js`
does it, using the coi-serviceworker technique merged with the PWA worker
(this is the only service worker for `/office/`):
- **Isolation headers:** it adds COOP, COEP and CORP to every response under
  `/office/`.
- **First visit:** the page registers the worker and reloads once. A
  sessionStorage flag stops reload loops and shows an error instead.
- **Big files:** requests for `soffice.wasm` and `soffice.data` are answered
  from the `.gz` files through `DecompressionStream('gzip')` with the right
  content type, because the fileserver can't send `Content-Encoding`.
- **Caching:**
  - The cache is versioned and old versions are deleted on activate.
  - Assets are cache-first and pages network-first, so after the first visit
    the 82 MB isn't downloaded again and the app works offline.
  - Redirected (login) and non-200 responses are never cached.
  - Hub API requests (`/utilities/...`) pass straight through.

**Requirement:** the ship must be reached over HTTPS, or through `localhost`.
Over plain HTTP on another host, browsers disable both service workers and
`SharedArrayBuffer`, and the app shows an error explaining this. Nothing else
is needed from the ship.

## Storage on the ship

The app uses the hub store on the same origin:
- **List:** `GET /utilities/api/store/office/`, filtered to document
  extensions (odt ods odp odg docx doc xlsx xls pptx ppt rtf txt csv pdf).
- **Open:** `GET /utilities/api/store/office/<path>`. The bytes are written to
  the wasm in-memory FS (`/tmp/office/...`) and loaded with
  `loadComponentFromURL`. The response's `ETag` is kept with the document.
- **Save:** `storeToURL` writes to the in-memory FS with the filter for the
  extension, then `PUT /utilities/api/store/office/<path>` with the document's
  MIME type as `content-type`. The save is conditional (see below), and the
  PUT response's `ETag` becomes the document's tag.
- **Delete:** `DELETE /utilities/api/store/office/<path>`, from the file list.

### Conflicts (ETag / If-Match)

A save never silently replaces someone else's version (another tab, device,
or app writing the same store item):
- Saving the document's own path sends `If-Match: <etag it was opened or last
  saved with>`.
- A new document, Save as to another name, and the PDF export to the ship send
  `If-None-Match: *` (create only).
- On `412` nothing is stored, the document is marked modified again (store()
  had cleared the flag), and a dialog offers:
  - **Save mine as a copy** (default): opens the Save dialog with
    `<name> (copy)`, saved create-only, and the document switches to it.
  - **Overwrite**: `HEAD` for the current ETag, then PUT with `If-Match` on it.
    If yet another write slips in between, the dialog comes back.
  - **Reload theirs (discard mine)**: reopens the ship version. Only offered
    when the path is the document's own (not for "file already exists" on
    Save as).
  - **Cancel**: nothing saved, the edits stay in the editor.
- The file list's Delete is unconditional (it has no loaded ETag).

Formats:
- Writer: odt, docx, doc, rtf, txt, html, pdf.
- Calc: ods, xlsx, xls, csv, pdf.
- Impress: odp, pptx, ppt, pdf.

LibreOffice's own file commands would open Qt file dialogs on the in-memory
FS, which crash the wasm thread. A dispatch interceptor
(`office_thread.js`) routes them to the page instead:
- **Ctrl+S / Save:** saves to the ship. A new document asks for a name first.
- **Save As / Export:** the page's Save as dialog.
- **Print, Export as PDF:** downloads a PDF.
- **Open, Close:** the document list.
- **File > New:** a new document.

The page also has "Open from computer…" (file input) and "Download" (export
in the document's format).

## Test

`test.js` (env `BASE_URL`, `SHIP_CODE`, `CHROME`) logs in like
`test/e2e.js` and then:
1. Starts LibreOffice and checks `crossOriginIsolated`.
2. Creates a Writer document, types text with the keyboard into the canvas,
   and saves it through the Save dialog as `e2e-<id>.odt`. It checks the item
   in `GET /utilities/api/store/office/`.
3. Reloads, opens the file from the ship list and checks the document text
   (read through UNO).
4. Edits, presses Ctrl+S (LibreOffice's own Save, intercepted), reloads,
   reopens and checks the edit.
5. Uses "Save as" `.docx` and checks the item is stored.
6. Conflicts: a direct `fetch` PUT (another writer) replaces the `.docx`, the
   app edits and saves; the test checks the store still holds the other
   writer's bytes and the conflict dialog is open, then picks "Save mine as a
   copy" and checks `<name> (copy).docx` is stored and the `.docx` is
   untouched.
7. Another writer changes the copy, Ctrl+S, "Overwrite": the store holds the
   app's document, the app's ETag matches the store, reopening shows the
   edit.
8. Another writer puts the `.odt` bytes on the copy, save, "Reload theirs":
   the editor shows their text without the local edit.
The expected `412`s are exempted from the "no 4xx" rule, and the test fails if
they don't happen.

It fails on page errors, any 4xx/5xx or failed request to the ship origin,
and any request to another origin. Result against the mock
(`kit/serve.py --port 8207`): PASS. With the conflict steps, against
`kit/serve.py --port 8242`: PASS, and `kit/pwa-check.js office` printed
`errors=[]` with the manifest. LibreOffice starts in 3-5 s on localhost
once cached.

I also checked Calc (type into A1, save as `.xlsx`) and Impress (new
presentation renders) by hand with puppeteer.

The PWA check, `kit/pwa-check.js office`, printed `errors=[]`, but with an
empty `manifest=`. The check runs while the page is doing its one-time
isolation reload. A copy of the check that waits for the reload printed
`sw scope=…/office/ manifest=…/office/manifest.webmanifest errors=[]`.

## Limitations

- **HTTPS or localhost only** (see above).
- **First visit downloads 82 MB.** Range requests wouldn't help much: the
  wasm must be fully downloaded to compile. Content-Encoding support in the
  fileserver would let us drop the SW decompression step, but it isn't needed.
- **Fonts:** only those bundled in `soffice.data` (Liberation, DejaVu,
  Carlito, Caladea, Amiri, …). There are no system fonts.
- **Help links** (F1, Help menu) open `help.libreoffice.org` in a new tab.
  These are user-initiated only, and the app makes no automatic external
  requests.
- **Opening a second document replaces the first** (one frame). The page
  asks before discarding unsaved changes.
- **Big documents:** memory use is high (the wasm heap is shared memory).
  Fine on desktop browsers, heavy on phones.
- **Conflicts are detected only at save time.** There is no live notice
  that someone else changed the file while you edit, and no merge. You
  choose copy, overwrite or reload.
