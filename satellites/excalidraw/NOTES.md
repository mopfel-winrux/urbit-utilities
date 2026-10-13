# excalidraw

Excalidraw is a virtual whiteboard for hand-drawn style diagrams. This desk is the
`excalidraw-app` with every excalidraw.com backend taken out. Drawings are saved on
your ship through the `%utilities` hub, and you can share a read-only link to one.

- Upstream: https://github.com/excalidraw/excalidraw, tag `v0.18.1`
  (commit `a2ec2889babf7d2295469c6d90ebe77fae57df84`). Only `excalidraw-app` and
  the in-repo `packages/*` are built.
- License: MIT. The bundled fonts (Excalifont, Virgil, Nunito, Lilita, Comic Shanns,
  Xiaolai, Assistant, Liberation, Cascadia) are OFL/MIT/Apache and allow
  redistribution.
- Desk size: 372 files, 20.9 MB. Fonts are 14 MB of that, mostly the CJK font
  Xiaolai, which is split into many small subsets loaded on demand.
- Build: `./build.sh`. It clones the tag into `upstream/` (gitignored), runs
  `git reset --hard` and `git clean`, applies `patches/*.patch`, writes
  `.env.production.local` with every service URL empty, runs `yarn install`
  (yarn 1 through npx) and `vite build`, and copies the result to `desk/web`.
  It then runs `kit/pwa.py`, `claysafe`, `marks` and `check`. The build takes about
  30 s once `node_modules` exists, and a rebuild from a fresh clone gave a
  byte-identical `desk/web`.
- Fileserver config: spa `|`, auth `[& ~[[/view |]]]`. The editor at
  `/excalidraw/` needs a login. Everything under `/excalidraw/view/` is public
  (see "Public viewer" below).

## Patches

### `patches/01-urbit.patch`: strip backends, base path, asset layout

- `excalidraw-app/vite.config.mts`:
  - `base: "/excalidraw/"`.
  - Two inputs, `index.html` (the editor) and `view/index.html` (the viewer).
  - Every JS, CSS, font, worker and locale file is emitted under `view/`.
  - No sourcemaps.
  - Removed: vite-plugin-pwa (its workbox worker; `kit/pwa.py` installs `sw.js`
    instead), the sitemap, checker, and the woff2 plugin that pointed fonts at the
    DigitalOcean CDN.
- `excalidraw-app/index.html`: removed the Simple Analytics script, the Google
  Fonts preconnects, the Excalidraw+ auto-redirect, the og/twitter tags with
  remote images, and the CDN font preloads. Sets
  `window.EXCALIDRAW_ASSET_PATH = "/"` so fonts load from
  `/excalidraw/view/fonts/...`. Favicons are base-prefixed.
- `excalidraw-app/index.tsx`: no Sentry import and no `registerSW`.
- `excalidraw-app/App.tsx`:
  - Live collaboration is off (`isCollabDisabled = true`).
  - Removed every import of `collab/*`, `data/index.ts` (the json.excalidraw.com
    share links), `data/firebase.ts`, `ShareDialog`, `ExportToExcalidrawPlus`,
    the AI/TTD components and the Excalidraw+ iframe export. Firebase and
    socket.io are no longer in the bundle.
  - `initializeScene` loads local storage only, so `#json=`, `#room=` and
    `#url=` links are ignored.
  - The command palette keeps GitHub, theme and install, and gets a "Ship drawings"
    entry.
  - The top-right UI shows the Ship trigger. `<ShipPanel>` is mounted.
- `AppMainMenu`, `AppWelcomeScreen` and `AppFooter`: removed the Excalidraw+
  sign-up and promo links, the collab entries and the "encrypted" footer badge.
  Added a "Ship drawings" menu item.
- `packages/excalidraw`:
  - `ExcalidrawFontFace.ts`: no `esm.sh` fallback URL for fonts.
  - `LibraryMenuBrowseButton.tsx`: hidden when `VITE_APP_LIBRARY_URL` is empty.
    That button is libraries.excalidraw.com, and installing from it fetches
    library files from their CDN.
  - `LibraryMenuHeaderContent.tsx`: "Publish library" is hidden when
    `VITE_APP_LIBRARY_BACKEND` is empty.
  - The local personal library (IndexedDB) and importing or exporting
    `.excalidrawlib` files still work.

### `patches/02-ship.patch`: ship storage and viewer (new files only)

- `excalidraw-app/ship/api.ts`: the hub client.
- `excalidraw-app/ship/ShipPanel.tsx` and `.scss`: the "Your ship" drawer, a
  native Excalidraw `<Sidebar>` opened by the **Ship** button at the top right,
  the main menu or the command palette.
  - **Save**: saves to the current ship file. If there is none yet, it works like
    Save as.
  - **Save as…**: asks for a name. It confirms before overwriting an existing
    drawing (the create-only PUT got 412).
  - Every save is conditional. The drawer remembers the `ETag` of the version
    it opened (GET) or last saved (PUT response), in localStorage with the
    current file. Saving the current file sends `If-Match: <that etag>`; saving
    to any other name sends `If-None-Match: *`. A `412` never overwrites.
  - **Save conflict** box: when a Save or autosave of the current file gets
    `412`, the drawer shows a red-bordered box (`role=alert`) with "Save
    conflict on <name>. Someone saved a different version on your ship." and
    three choices:
    - **Overwrite theirs with mine**: PUT without a condition, then carry on
      with the new ETag.
    - **Save mine as a copy…**: opens the Save as field prefilled with
      "<name> (my copy)". The copy becomes the current file and theirs is left
      alone.
    - **Discard mine, load theirs**: GETs the ship version (and its ETag) and
      replaces the canvas, without the usual "discard changes?" prompt.
    Any successful save or open clears the box. A saved current file
    remembered by an older build (no ETag) saves create-only, so its first save
    after the upgrade shows the conflict box rather than guessing.
  - **Drawings**: lists drawings, newest first, each with **Open** and **Delete**
    (with confirm). Open asks before discarding unsaved changes.
  - **Autosave to ship**: a checkbox, off by default, remembered per browser. It
    only works once the drawing has been saved to or opened from the ship. It saves
    3 s after the last change, and only when the scene's elements, files or
    background actually changed. Each write is an `If-Match` PUT. On `412`
    autosave pauses (the checkbox stays on), shows a toast, opens the drawer at
    the conflict box and says "Autosave paused". It does not write again until
    the conflict is resolved.
  - **Share read-only link**: PUTs a public snapshot and shows two links with
    Copy buttons: the viewer link and the raw `/utilities/pub/...` file. A
    "Shared links" list shows each share with **Revoke** (DELETE).
- `excalidraw-app/view/index.html` and `view/main.tsx`: a minimal read-only viewer.
  It reads the path from the URL fragment, `/excalidraw/view/#shared/<file>`, does
  a GET to `/utilities/pub/excalidraw/<file>` with no credentials, and renders
  `<Excalidraw viewModeEnabled>`. The menu has only export image, theme and help.
  It uses no local storage scene, no library and no ship API.

To change the patches, edit `upstream/` and then run
`git -C upstream add -N excalidraw-app/ship excalidraw-app/view`. Next run
`git -C upstream diff -- . ':!excalidraw-app/ship' ':!excalidraw-app/view' > patches/01-urbit.patch`
and `git -C upstream diff -- excalidraw-app/ship excalidraw-app/view > patches/02-ship.patch`.

## Hub API usage (same origin, cookie auth)

| what | request |
|---|---|
| list drawings | `GET /utilities/api/store/excalidraw/?prefix=drawings/` |
| list shares | `GET /utilities/api/store/excalidraw/?prefix=shared/` |
| open (remember the `ETag`) | `GET /utilities/api/store/excalidraw/drawings/<name>.excalidraw` |
| save, autosave of the current file | `PUT /utilities/api/store/excalidraw/drawings/<name>.excalidraw` with `If-Match: <etag>`, `content-type: application/vnd.excalidraw+json`, body is the standard `.excalidraw` JSON with images embedded. The response's `ETag` is remembered. `412` opens the conflict box |
| save as / first save to a name | the same PUT with `If-None-Match: *` (create only). `412` asks "Replace it?" |
| overwrite theirs, confirmed replace | the same PUT with no condition |
| ETag fallback | `HEAD` of the item, only if a PUT response carries no `ETag` |
| share | `PUT /utilities/api/store/excalidraw/shared/<slug>-<24 hex>.excalidraw`, the same content type plus `x-utilities-public: true` (no burn, no expiry) |
| delete, revoke | `DELETE /utilities/api/store/excalidraw/<path>` |
| viewer, no login | `GET /utilities/pub/excalidraw/shared/<slug>-<24 hex>.excalidraw` (`credentials: omit`) |

Names keep the user's spelling. Only `/`, `\`, control characters, leading dots
and a trailing `.excalidraw` are removed, and each segment is URL-encoded, so
"My diagram" is stored as `drawings/My diagram.excalidraw`. Share paths are
slugged (`[a-z0-9-]`) and carry a random 96-bit id, so they can't be guessed.

## Public viewer and the `/view` sub-path

The fileserver can only make a path prefix public, and the viewer needs the JS,
CSS and fonts too. So every bundled file is built under `web/view/`: the editor's
`index.html` at `/excalidraw/` (login required) loads
`/excalidraw/view/assets/*.js`. Only `index.html`, the manifest, `sw.js` and the
favicons sit outside `view/`. As a result, the app's static code (open source, no
user data) is fetchable without a login. Drawings are not: the only data a
logged-out visitor can reach is what the owner explicitly shared through
`/utilities/pub`.

## PWA

`kit/pwa.py` creates `manifest.webmanifest` (scope `/excalidraw/`) and installs
`kit/pwa-sw.js` as `/excalidraw/sw.js`. Upstream's own workbox worker is removed,
and so is the CRA "service-worker.js" killer. `BASE_URL=... node kit/pwa-check.js excalidraw`
reports `sw scope=/excalidraw/ ... errors=[]`.

## Tested

`test.js` (env `BASE_URL`, `SHIP_CODE`, `CHROME`) passes on the mock ship:

1. Logs in like `test/e2e.js` and loads `/excalidraw/` with empty local storage.
2. Draws a rectangle and an ellipse, opens the Ship drawer, and runs Save, which
   asks for a name. It checks the list API shows the item as private, and that the
   GET body is an excalidraw scene with 2 elements.
3. Wipes local storage, reloads (the canvas is empty), opens the drawing from the
   drawer, and checks the same element ids are back.
4. Turns on autosave and draws a diamond. The ship copy reaches 3 elements.
5. Shares a read-only link. It checks the link shapes and that the store item has
   `public: true`.
6. In a fresh browser context with no cookie, it opens the viewer link: 3
   elements, view mode on. A logged-out GET of the `/utilities/pub` URL returns
   the file.
7. Concurrent writer: the test PUTs a 1-element scene straight to the store,
   then draws with autosave on. Autosave gets `412`, the conflict box appears
   with "Autosave paused", and after two autosave windows the ship still has
   the other writer's scene. **Save mine as a copy** stores the 5 local elements as
   "<name> (my copy)" and leaves the original alone. With autosave off,
   another outside write followed by a manual Save gets `412` and no overwrite.
   **Overwrite theirs with mine** then stores the 6 local elements. A third
   outside write and Save, then **Discard mine, load theirs**, shows their
   1 element, and the next Save goes through with the new ETag. It also checks
   that the first save sent `If-None-Match: *` and autosave sent `If-Match`.
8. Revokes the share and deletes the drawing through the drawer, and checks both
   are gone from the store.
9. The test fails on any page error, any request to another origin, and any
   ship response with status 4xx or 5xx, except the `412`s it provokes on
   purpose.

The test also passes on a copy of `kit/serve.py` with its auth parsing fixed (see
below), where `/excalidraw/` really returns 403 without a cookie. That confirms
the viewer loads only public files.

## Limitations

- No live collaboration, share links to excalidraw.com, AI or text-to-diagram,
  Excalidraw+, or public library browsing or publishing.
- External links that the user clicks (GitHub, help docs, YouTube/Vimeo/Figma
  embeds that the user adds to a drawing) still go to the internet. That is only
  on user action.
- Shared links are snapshots. They don't update when you keep editing, so share
  again and revoke the old one. They never expire, because no
  `x-utilities-expires` header is sent.
- Conflict detection is atomic on the hub (`If-Match` / `If-None-Match`),
  but there is no merge. You pick mine, theirs, or both as two files. The
  explicit "Overwrite theirs" and the confirmed "Replace it?" are
  unconditional PUTs, so a third save in that moment would be lost.
- Delete and Revoke are not conditional.
- Images live inside the `.excalidraw` JSON as data URLs, so drawings with many
  images make large store items.
- The editor's local scene is still in browser localStorage and IndexedDB, as
  upstream. The ship copy is explicit (Save) or autosave.
