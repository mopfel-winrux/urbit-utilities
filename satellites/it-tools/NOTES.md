# it-tools

- Upstream: https://github.com/CorentinTh/it-tools
- Version: tag `v2024.10.22-7ca5933` (commit `5732483fc24a6e6818839060bdf3cc7d9d324b9f`), built from source (pnpm 8.15.3, Vite)
- License: GPL-3.0 (`GPL-3.0-only` in the docket; upstream ships the plain GPLv3 text)
- Served at `/it-tools/`, history routing, so `spa=&`. Built with `BASE_URL=/it-tools/`.
- Size of `desk/web`: 15.9 MB, 571 files

## Patches (`patches/urbit.patch`, plus build steps)
- Removed `vite-plugin-pwa` and its `registerSW()` call. `kit/pwa.py` installs the kit's `/it-tools/`-scoped worker and manifest instead.
- ASCII Art Text Generator: upstream loads figlet fonts from `unpkg.com`. The build copies `node_modules/figlet/fonts/*.flf` to `figlet-fonts/` and points `fontPath` there. Font names with spaces or capitals rely on claysafe and the fileserver's URL encoding. Checked: `ANSI%20Shadow.flf` returns 200.
- Plausible analytics stays disabled (`VITE_TRACKER_ENABLED` is unset, so it gets the no-op tracker). Source maps are dropped.

## Tested
- `test.js` loads `/it-tools/`, opens the deep link `/it-tools/hash-text`, types a string and checks that its SHA-256 appears. No page errors and no external requests.
- A crawl of all 86 tool routes found no external or failed requests. The only page error was camera-recorder in headless Chrome, which has no camera.
- `kit/pwa-check.js it-tools` prints `errors=[]`.

## Known issues
- Links such as GitHub, Twitter and "Buy me a coffee" in the header open external sites when clicked. They make no background requests.
