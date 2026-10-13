# cyberchef

- Upstream: https://github.com/gchq/CyberChef
- Version: v11.5.0, from the official standalone release zip `CyberChef_8cd426dd4f40f1423912d5fad91b578a86a65112.zip` (sha256 `f6478925…cccf`, verified in build.sh). The tile icon `cyberchef-512x512.png` comes from the v11.5.0 source tree and its sha256 is also verified.
- License: Apache-2.0
- Served at `/cyberchef/`. It uses hash state (`#recipe=…&input=…`), so `spa=|`.
- Size of `desk/web`: 61 MB, 79 files (13.6 MB of `main.js` plus the OCR assets)

## Build
- Unzip the release, rename `CyberChef_v11.5.0.html` to `index.html`, and delete the precompressed `.br`/`.gz` copies. `.gz` files without an uncompressed sibling are kept: tesseract fetches `eng.traineddata.gz` as-is.
- claysafe handles the camelCase module names (for example `modules/Shellcode.js` becomes `modules/~shellcode.js`). The fileserver applies the same encoding to request URLs.
- `kit/marks.py`: added `fnt` (bitmap font descriptors in `assets/fonts`).
- `kit/pwa.py` adds the manifest and the kit service worker.

## Tested
- `test.js` opens `/cyberchef/#recipe=To_Base64(...)&input=<b64>` and checks the output is `aGVsbG8gZnJvbSB1cmJpdA==`. It then types `urbit` into the input editor and checks that auto-bake outputs `dXJiaXQ=`. No page errors and no external requests.
- `kit/pwa-check.js cyberchef` prints `errors=[]`.

## Known issues
- A few operations need the internet by design and only run when the user adds them to a recipe: HTTP request, DNS over HTTPS and Show on map.
- The "Download CyberChef" modal links to GitHub releases.
