# mermaid

- Upstream: https://github.com/mermaid-js/mermaid-live-editor
- Version: commit `d46f60bc0fd6b71a56dc73c1711c7b4313b81310` (main, 2026-10-12; upstream has no release tags). Mermaid v12.1.0.
- License: MIT
- Built from source with pnpm 10.34.6. Upstream requires node >= 24.16, so build.sh downloads node v24.21.0 into `upstream/.node` and checks its sha256.
- Served at `/mermaid/` (`MERMAID_BASE_PATH=/mermaid`, `paths.relative=false`), `spa=&`. The prerendered routes `edit`, `view` and `embed` are moved to `<route>/index.html` so deep links get their own page.
- Size of `desk/web`: 24.3 MB, 255 files

## Offline configuration (env in build.sh)
- `MERMAID_ANALYTICS_URL=''`: Plausible is never loaded. The `[plausible]` console lines on localhost are local logs only.
- `MERMAID_IS_ENABLED_MERMAID_CHART_LINKS=false`: hides all Mermaid Chart / mermaid.ai links, the promo banners, the "Edit in Playground" and "Plugins" menu items, the AI and "enhanced edits" buttons and the editor-chooser modal.
- `MERMAID_RENDERER_URL=''` and `MERMAID_KROKI_RENDERER_URL=''`: no mermaid.ink or kroki.io image or link actions.
- `MERMAID_HIDE_PRIVACY_POLICY=true`.

## Patches (`patches/urbit.patch`)
- Monaco's JSON schema request is off (`enableSchemaRequest: false`). Otherwise the Config tab fetched `mermaid.js.org/schemas/config.schema.json`.
- `svelte.config.js`: `paths.relative: false`, so the base-absolute asset URLs work at any depth.
- `static/manifest.json`: the icon path is relative. `kit/pwa.py` fixes `start_url`, `scope` and `id` and adds the 192 and 512 icons.

## Tested
- `test.js` opens the deep link `/mermaid/edit#base64:{code}` and checks that the flowchart renders to SVG with the expected labels. It then types a sequence diagram into Monaco and checks the SVG updates (`aria-roledescription=sequence`). No page errors and no external requests.
- `kit/pwa-check.js mermaid` prints `errors=[]`. The app keeps its own no-op service worker (`/mermaid/service-worker.js`, scope `/mermaid/`), so it is installable but not offline-cached.

## Known issues
- Exported SVG files keep upstream's `<?xml-stylesheet href="https://cdnjs…/font-awesome…">` line, so FontAwesome icons render in the exported file elsewhere. The app itself uses the vendored FontAwesome.
- Loading a diagram from a GitHub gist (`#gist=`), and the Docs, Discord and GitHub links, need the internet. They only run when the user acts.
