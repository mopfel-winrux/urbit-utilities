# EmulatorJS satellite (`%emulatorjs`, served at `/emulatorjs/`)

## Upstream

- EmulatorJS https://github.com/EmulatorJS/EmulatorJS, **v4.2.3** (npm `@emulatorjs/emulatorjs@4.2.3`), GPL-3.0.
- Prebuilt RetroArch cores: npm `@emulatorjs/core-<name>@4.2.3` (the same files the
  cdn.emulatorjs.org 4.2.3 release serves). Each tarball's sha512 is pinned in `build.sh`.

## What build.sh does

1. Downloads the npm tarballs into `upstream/tgz/` and verifies their sha512 integrity.
2. `patches/offline.py` edits `data/src/emulator.js`: removes the update check
   (`cdn.emulatorjs.org/stable/data/version.json`), removes the CDN fallback for cores that
   aren't vendored (it now fails with "Error downloading core"), and drops the default netplay
   server (`netplay.emulatorjs.org`; netplay is also disabled upstream unless debug mode is on).
3. Builds `data/emulator.min.js` by concatenating the scripts `loader.js` would load in
   debug mode (the npm package ships no minified bundle) and copies `emulator.css` to
   `emulator.min.css`.
4. Copies `loader.js`, `compression/` (7z/zip/rar extractors), `localization/`, and for each
   selected core only the two non-threaded builds, `<core>-wasm.data` (WebGL2) and
   `<core>-legacy-wasm.data` (WebGL1; this is what EmulatorJS picks by default for most cores),
   plus `cores/reports/<core>.json`.
5. Adds the launcher (`src/index.html`, `src/launcher.js`, `src/icon.svg`), then runs
   `kit/pwa.py`, `kit/claysafe.py`, `kit/marks.py` and `kit/check.py`.

The launcher lets you pick a ROM file (File API) and a system (guessed from the extension),
then sets the `EJS_*` globals (the ROM is passed as a `File`, so nothing is uploaded) and loads
`data/loader.js`. "Load another game" reloads the page. The UI language follows the browser
if a shipped localization exists, otherwise en-US (so there are no 404s for missing languages).

## Included cores (desk is 52 MB, 87 files)

| system (EJS id) | core | core license |
|---|---|---|
| NES / Famicom (`nes`) | fceumm | GPL-2.0 |
| SNES (`snes`) | snes9x | Snes9x license (non-commercial) |
| Game Boy / Color (`gb`) | gambatte | GPL-2.0 |
| Game Boy Advance (`gba`) | mgba | MPL-2.0 |
| Nintendo 64 (`n64`) | mupen64plus_next | GPL-2.0 |
| Nintendo DS (`nds`) | melonds | GPL-3.0 |
| Virtual Boy (`vb`) | beetle_vb (mednafen) | GPL-2.0 |
| Genesis / Mega Drive, Master System, Game Gear (`segaMD`, `segaMS`, `segaGG`) | genesis_plus_gx | Genesis Plus GX license (non-commercial) |
| Sega 32X (`sega32x`) | picodrive | PicoDrive license (non-commercial) |
| PlayStation (`psx`) | pcsx_rearmed | GPL-2.0 |
| PC Engine / TurboGrafx-16 (`pce`) | mednafen_pce | GPL-2.0 |
| Neo Geo Pocket / Color (`ngp`) | mednafen_ngp | GPL-2.0 |
| WonderSwan / Color (`ws`) | mednafen_wswan | GPL-2.0 |
| Atari 2600 (`atari2600`) | stella2014 | GPL-2.0 |
| Atari 7800 (`atari7800`) | prosystem | GPL-2.0 |
| Commodore 64 (`c64`) | vice_x64sc | GPL-2.0 |
| Arcade (`arcade`) | fbneo | FBNeo license (non-commercial) |

Each core's `.data` (a 7z archive) carries its own `license.txt`, which EmulatorJS shows in its
menu. Several cores (snes9x, genesis_plus_gx, picodrive, fbneo) are free for non-commercial
use only. The desk license is recorded as GPL-3.0 (EmulatorJS); `web/license.txt` is
EmulatorJS's LICENSE.

Not included: cores that need SharedArrayBuffer/threads (`ppsspp` for PSP, `dosbox_pure`),
because the Urbit fileserver can't send COOP/COEP headers; cores that need a BIOS the user would
have to supply (Lynx, ColecoVision, 5200, 3DO, Saturn, Jaguar, PC-FX, Amiga); and alternative
cores for already-covered systems (nestopia, smsplus, desmume, parallel_n64,
mednafen_psx_hw, mame2003*). If a user picks one of those in EmulatorJS's settings
("Core"), the core fails to load with "Error downloading core" instead of hitting the CDN.

### Adding a core

Append `<core> <integrity>` to `CORES` in `build.sh` (integrity from
`npm view @emulatorjs/core-<core>@4.2.3 dist.integrity`), add the system to `SYSTEMS` in
`src/launcher.js`, and rerun `./build.sh`. Most cores are 1 to 1.5 MB per variant (fbneo is 8 MB).

## Test

`test.js` logs in via `/~/login`, opens `/emulatorjs/`, loads `samples/240pee.nes` with the
file input (the launcher selects NES), starts it, waits until `EJS_emulator.started`, then
screenshots the canvas after 4 s and requires a non-blank frame (`out/emulatorjs.png`). It fails
on page errors, failed requests or HTTP >= 400 from the ship, and on any request to another origin.
Result on the mock (port 8205): PASS, fceumm, the 240p Test Suite credits screen rendered
(10 colours, 89% lit). `kit/pwa-check.js emulatorjs`: `errors=[]`.

Only the NES core was exercised end to end. The other cores are the upstream builds,
unmodified.

### Sample ROM

`samples/240pee.nes` is the NES port of 240p Test Suite v0.23 by Damian Yerrick and Artemio
Urbina, from https://github.com/pinobatch/240p-test-mini/releases/tag/v0.23
(sha256 `04f01d7372f66ea2befe325b9bd655a9fcc395a31fa46d9466286bb8f9d2e62e`).
License: GPL-2.0-or-later. Source: https://github.com/pinobatch/240p-test-mini (tag v0.23).
It isn't part of the desk.

## Limitations

- No ROM hosting yet: games come from the user's computer each time. Saves and states are kept
  in the browser's IndexedDB by EmulatorJS.
- Netplay, which needs an external server, is off. So are PSP and other threaded cores.
- No COOP/COEP headers are sent, so cores always run single-threaded.
- The kit service worker caches each core after its first use. A core is 1 to 8 MB.
- In headless Chrome, rendering uses SwiftShader. On real browsers, WebGL2 is used for cores
  whose report sets `defaultWebGL2` (N64, PS1, DS) and the legacy WebGL1 build for the rest.
