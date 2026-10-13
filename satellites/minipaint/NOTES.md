# miniPaint satellite

- Upstream: https://github.com/viliusle/miniPaint, tag `v4.14.3` (commit `a79733eb803fc97084ef0ee4faa96b031e69e1c0`)
- License: MIT
- Build: `build.sh` shallow-clones the tag, applies `patches/urbit.patch`, `npm ci` + webpack production build (node 22), then copies `index.html`, `dist/bundle.js`, `images/` and the GIF encoder worker into `desk/web`, runs `kit/pwa.py`, claysafe, marks, check.
- `desk/web`: 1.6 MB, 50 files. All asset paths are relative, so it works under `/minipaint/` as is.

## Patches (`patches/urbit.patch`)
- `webpack.config.js`: `publicPath: ''` (was `/dist/`), no source maps.
- Removed the Pixabay "Search Images" tool and File menu entry (external API).
- Removed "[Add Font...]" (Google Fonts search) from the text tool; fonts saved in `.json` projects that aren't installed locally fall back to local fonts instead of loading from Google Fonts.
- `build.sh` also drops the commented-out manifest link (kit/pwa.py would otherwise pick it up), the social meta tags pointing at github.io, and `images/preview.*` (3.4 MB, docs only).

## PWA
No app worker (upstream's registration is commented out), so `kit/pwa.py` installs `sw.js` and `manifest.webmanifest`. `kit/pwa-check.js minipaint` -> `errors=[]`.

## Tested (`test.js`)
Opens a generated 120x80 colored PNG through File > Open > Open File, applies Effects > Common Filters > Grayscale, exports through File > Export, and checks the downloaded PNG is 120x80 and grayscale. No page errors, failed or 4xx/5xx ship requests, or external requests.

## Known issues
- File > Open > "Open URL" fetches whatever URL the user types (user-initiated; cross-origin images need CORS).
- Help > About and the "External" tools menu link out to other websites (navigation only).
