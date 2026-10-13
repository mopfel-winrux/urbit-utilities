# js-dos satellite (`%jsdos`, served at `/jsdos/`)

## Upstream

- js-dos https://github.com/caiiiycuk/js-dos, **v8.5.3** (tag commit `506dfd2a`), GPL-2.0.
  build.sh downloads the release asset
  `https://github.com/caiiiycuk/js-dos/releases/download/v8.5.3/release.zip`
  (sha256 `bff63d50dbec7c6f21ababc23a2b587c32785f66b464ffe68df38e821b945c89`), which holds the
  prebuilt `dist/`, including the emulators (js-dos/emulators build "8.5.2 (99337d87…)").
- Emulators (https://github.com/js-dos/emulators, GPL-2.0): DOSBox (`wdosbox.*`, GPL-2.0+),
  DOSBox-X (`wdosbox-x.*` and the JSPI build `wdosbox-x-jspi.*`, GPL-2.0+), and libzip (`wlibzip.*`,
  BSD-3-Clause). `web/license.txt` lists them and links to the source.

## What build.sh does

1. Downloads and verifies the release zip into `upstream/`.
2. `patches/offline.py` edits `dist/js-dos.js`:
   - The default `pathPrefix` (`https://v8.js-dos.com/latest/emulators/`) becomes the
     vendored `emulators/` folder next to js-dos.js. The launcher also passes it explicitly.
   - Removes the Dhrystone result upload to `…apigw.yandexcloud.net/perf/set`.
3. Copies `js-dos.js`, `js-dos.css` and the runtime emulator files (no source maps, `.symbols`,
   debug build or typings) to `web/js-dos/`, and adds the launcher. Then it runs
   `kit/pwa.py`, `claysafe`, `marks` and `check`.

Desk size: 19.3 MB in 25 files. Most of it is `wdosbox-x.wasm` (8.0 MB),
`wdosbox-x-jspi.wasm` (7.9 MB) and `wdosbox.wasm` (1.5 MB).

No build is threaded. js-dos runs the emulator in a plain Web Worker, so no
SharedArrayBuffer and no COOP/COEP are needed.

## Launcher

`index.html` and `launcher.js` take a `.jsdos` bundle or a `.zip` from the user's computer and
read it in the browser:
- **.jsdos** (or any zip containing `.jsdos/dosbox.conf`): it runs as is.
- **plain .zip**: the launcher lists the `.exe/.com/.bat` files it contains and picks the most
  likely one (shallowest path, not SETUP/INSTALL). The user can choose another program or a bare
  DOS prompt. It then appends a `.jsdos/dosbox.conf` (`mount c .`, `c:`, `cd`, then the program)
  to the zip in the browser, copying the existing entries byte for byte. Zip64 is not supported.
- Emulator: DOSBox (default) or DOSBox-X, remembered in localStorage.
- Saved changes (js-dos stores them in OPFS) are keyed by file name, so they persist across
  sessions for the same file.

## Test

`test.js` logs in via `/~/login` and opens `/jsdos/`. It runs three cases through the file input:
`samples/plasma.zip` on DOSBox, `samples/plasma.jsdos` on DOSBox, and `samples/plasma.zip` on DOSBox-X.
For each case it checks the right wasm was loaded, then screenshots the canvas every second until
it shows a VGA frame (32 or more colours, more than 20% lit) that differs from the previous one,
which means the program is animating. Screenshots go to `out/`. It fails on page errors, failed
requests or HTTP >= 400 from the ship, and on any request to another origin. Result on the mock
(port 8205): PASS for all three cases, each in about 3 s. `kit/pwa-check.js jsdos`: `errors=[]`.

### Samples (not in the desk)

`samples/plasma.zip` and `samples/plasma.jsdos` contain `PLASMA.COM`, an 87-byte animated XOR
pattern in VGA mode 13h (any key exits). It was written for this satellite from
`samples/src/plasma.s` and is released as **CC0-1.0**. `samples/make-samples.sh` rebuilds it with
GNU as/ld.

## Limitations / runtime network use

All runtime files are vendored. The test saw no external requests. These js-dos features still
reach dos.zone if the user turns them on, and are otherwise unused:
- Networking and IPX: WebRTC via `https://net.dos.zone`.
- "Sockdrive" system images (DOS 7.1, Win 3.11, Win 95/98) from `br.cdn.dos.zone`. They appear
  only in js-dos's own "select" window or in bundles that reference sockdrives.
- The "update" button of the outdated-hardware-service warning opens dos.zone/download.
- No cloud saves or login: changes stay in the browser (OPFS).

Other limitations:
- No hosting of programs yet: each one comes from the user's computer.
- Audio could not be checked headlessly ("sampleRate === 0" warning in headless Chrome).
- The kit service worker caches the emulator wasm after its first use.
