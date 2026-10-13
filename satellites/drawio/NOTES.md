# draw.io satellite

- Upstream: https://github.com/jgraph/drawio, tag `v32.4.1` (commit `9034053fba80a435e27d68d374bc564b83917ae9`)
- License: Apache-2.0
- Build: `build.sh` shallow-clones the tag and uses the static app in `src/main/webapp`. Its minified bundles (`js/app.min.js`, `extensions.min.js`, …) are jgraph's official release build, committed at the tag (rebuilding them needs ant + the closure compiler; not done). The build trims, configures, and runs `kit/pwa.py`, claysafe (2017 camelCase files renamed), marks, check. LICENSE files are kept as `LICENSE.txt` (extensionless files can't be served).
- `desk/web`: 60 MB, 2878 files (`src/main/webapp` is 110 MB).

## Offline configuration
`patches/PreConfig.js` replaces `js/PreConfig.js` (it runs after `bootstrap.js` parses `urlParams` and before `app.min.js`):
`offline=1`, `lockdown=1`, `plugins=0`, `gapi/picker/db/od/gh/gl/tr/ms365=0`, `mode=device`, `sync=manual`, `EXPORT_URL=null`, no notifications/log URL. That disables Google Drive, OneDrive, Dropbox, GitHub, GitLab, Trello, M365, plugins, Pusher realtime, the realtime cache, notifications/update checks and logging. `patches/PostConfig.js` also nulls `REALTIME_URL`, `RT_WEBSOCKET_URL`, icon search. Save and open use this device (browser download / file picker).

## Trimmed
Server and integration files (`WEB-INF`, `META-INF`, `connect/`, `teams/dropbox/github/gitlab/onedrive3/export3/vsdxImporter.html`, `js/integrate.min.js` 19 MB, the viewer bundles, OneDrive/Dropbox/simplepeer SDKs), `plugins/`, dev sources (`js/diagramly`, `js/grapheditor`), source maps, legacy workbox file, and the meta image/canonical tags.

## PWA
draw.io's own precache worker (`service-worker.js`, scope `/drawio/`) is kept; `build.sh` filters its precache manifest to files that exist after trimming (otherwise the install fails), and `enableSW=1` installs it on the first load (55 precache entries, ~28 MB). It rejects error responses and HTML bodies for non-HTML entries, so a login page is never cached as an asset. `kit/pwa.py` normalizes `images/manifest.json`. `kit/pwa-check.js drawio` -> `errors=[]`.

## Tested (`test.js`)
Inserts a rectangle through the toolbar Insert menu, labels it "Hello Urbit", runs File > Export as > SVG > Export (saved to this device), and checks the SVG contains the label, the cell and the embedded `mxfile` XML. No page errors, failed/4xx ship requests or external requests (the full page load makes only same-origin requests).

## Known issues
- PDF export uses the browser print dialog (no export server).
- Diagrams that use Google web fonts (`fontSource`) fall back to local fonts. Help menu items and template/shape library links that point at drawio.com open external pages (navigation only).
- In headless/first run the shapes sidebar and format panel start collapsed (same with upstream's config); the toolbar toggles them.
