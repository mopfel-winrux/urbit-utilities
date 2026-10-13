# superprod: Super Productivity

- Upstream: https://github.com/johannesjo/super-productivity (redirects to
  super-productivity/super-productivity), tag **v19.2.0**, web build
  (`npm run buildFrontend:prodWeb`, Angular 21 + esbuild).
- License: **MIT** (Copyright (c) 2018 Johannes Millan). Redistribution is fine.
- Desk: `%superprod`, served at `/superprod/`, login required (`auth &`, `spa |`;
  the app uses hash routing and `<base href="./">`).
- Size: 797 files, 20.8 MB (6.1 MB of it is i18n JSON, 2.5 MB bundled plugins).
  Source maps are turned off.

## Build

`./build.sh` clones the tag into `upstream/` (once), runs `npm ci
--ignore-scripts`, resets the tree to the tag and applies `patches/urbit.patch`,
does what upstream's `postinstall`/`prepare` would (patch-package, ts-patch, env,
build the `sync-core`, `sync-providers`, `shared-schema` and `plugin-api`
workspace packages), then builds the web app and post-processes `desk/web`:

1. copies `kit/shim.js` to `web/shim.js` and loads it as the first script in
   `index.html` (right after `<base>`), before the app's module scripts;
2. `web/icon.png` = upstream's `icon-512x512.png`;
3. `kit/pwa.py` (manifest scope/start_url/id -> `/superprod/`, manifest link gets
   `crossorigin="use-credentials"`). The app keeps its own Angular service worker
   (`ngsw-worker.js`, registered relative to `/superprod/`, scope `/superprod/`);
4. regenerates `ngsw.json` with `ngsw-config` because steps 1 and 3 changed
   hashed files (otherwise the service worker would reject the version);
5. `kit/claysafe.py` (Angular's hashed chunk names are upper case), `kit/marks.py`,
   `kit/check.py`.

Re-running is idempotent (~1.5 min with `node_modules` present).

## Patches (`patches/urbit.patch`)

- `packages/sync-providers/.../webdav-api.ts`: no `Authorization` header when the
  WebDAV base URL contains `/utilities/dav/` (cookie auth on the same origin).
- `src/app/op-log/sync-providers/credential-store.service.ts`: if no WebDAV
  credentials are stored, `load()` returns the ship default
  `{baseUrl: location.origin + '/utilities/dav/superprod', syncFolderPath:
  'super-productivity', userName: 'ship', password: 'cookie'}` (user and
  password are placeholders that only satisfy SP's "is configured" checks; they
  are never sent).
- `src/app/features/config/default-global-config.const.ts`: sync is enabled by
  default with provider WebDAV. So a new install syncs to the ship with no
  setup. A user can still change provider or URL in Settings > Sync.
- `angular.json`: `sourceMap: false` for `productionWeb`.

Analytics and update checks: the web build has none. There is no analytics or
telemetry code in SP; the GitHub release check (`UpdateCheckService`) only
runs in Electron (`isUpdateCheckPossible()` is false on the web), and PWA updates
come from the service worker on the ship. No patch was needed. The test fails on
any request that leaves the ship origin, and none happened.

## How it uses the hub

WebDAV HTTP client: on the web, SP's WebDAV provider calls `fetch` through
`APP_WEB_FETCH` (looked up at call time as `globalThis.CapacitorWebFetch ??
fetch`; the Capacitor `WebDavHttp` plugin is only used on native Android/iOS).
So `kit/shim.js`'s `window.fetch` patch covers every request. Requests are
same-origin, `credentials` default (`same-origin`), `cache: 'no-store'`, so the
`urbauth-~nus` cookie authenticates them.

Requests observed in a sync (all under `/utilities/dav/superprod/super-productivity/`):

| what | wire request |
|---|---|
| read remote state | `GET sync-data.json`, `GET sync-ops.json`, `GET __meta_` (404 is normal until they exist); SP keeps the response `ETag` as the file's rev |
| backup before overwrite | `PUT sync-data.json.bak` (unconditional), then `GET` to verify |
| stale-rev pre-check | `POST` + `X-HTTP-Method-Override: PROPFIND` (`Depth: 0`) on `sync-data.json`, compares `getetag` with the rev |
| upload | `PUT sync-data.json` with `If-Match: "<rev>"` (JSON text, `Content-Type: application/octet-stream`), then `GET` to verify and take the new rev from its `ETag` |
| first upload to an empty store | `PUT sync-data.json` with no precondition (forced initial upload, `201`) |
| create folder (when needed) | `POST` + `X-HTTP-Method-Override: MKCOL` |
| "Test connection" button | `POST` + `X-HTTP-Method-Override: PROPFIND` on `/utilities/dav/superprod/` |

### Conditional requests and conflicts

Checked against `kit/serve.py` with the ETag/If-Match support from
`kit/CONTRACT.md`. No patch is needed; upstream's `webdav-api.ts` already
does the right thing with our tags:

- `download()` keeps the strong `ETag` of the `GET` as the rev (it falls back
  to a content hash only if there is no strong tag). Our `"<16 hex>"` tags pass
  its strong-ETag check.
- `upload()` with a strong rev first does `PROPFIND Depth: 0` and compares
  `getetag` (ours is identical to the `ETag` header), then sends
  `PUT` with `If-Match: <rev>`. It ignores the `ETag` on the PUT response; the
  new rev comes from the verify `GET` right after. `If-None-Match: *` is only
  sent for a non-forced upload with rev `null`, which the op-log sync never
  does in practice (the first upload is forced). `.bak` writes are forced
  (no precondition). SP never sends `If-None-Match` on `GET`, never uses
  `HEAD`, and does not read a 412 body.
- A `412` becomes `RemoteFileChangedUnexpectedly` ->
  `UploadRevToMatchMismatchAPIError`. The file-based adapter re-downloads; if
  the rev changed it gives up for this cycle without force-overwriting. The
  sync wrapper treats it as self-healing: no dialog, no error snackbar, the
  sync button shows no error, status `UNKNOWN_OR_CHANGED`. Two console errors
  are logged ("Concurrent upload detected..."). The next sync downloads the
  other client's ops, merges them (op log + vector clocks) and uploads with
  the new `If-Match`. No conflict dialog appears for concurrent task edits.
- In the ordinary "B changed without pulling" case there is no 412 at all:
  every SP sync downloads before it uploads (and SP syncs on its own shortly
  after a local change), so B merges A's ops first and its `If-Match` names
  the current tag.

Mock caveat (kit/serve.py, not the hub): on a `412` (and other early
answers) for `PUT` it doesn't read the request body, so on a keep-alive
connection the next request is parsed from the leftover body and gets `400
Bad request syntax`. In a browser this turned SP's harmless 412 into a
visible sync error. The test works around it (see below); Vere reads the whole
request, so the real hub is not affected.

The test additionally reads `GET /utilities/api/store/superprod/?prefix=super-productivity/`
and `GET /utilities/api/store/superprod/super-productivity/sync-data.json`.

## Test (`test.js`)

`BASE_URL` (default `http://localhost:8206`), `SHIP_CODE`, `CHROME`.

1. Context A (fresh profile): log in via `/~/login`, open `/superprod/`, let the
   automatic first sync run (accepting SP's "Initial Sync: download remote
   data?" confirm if the ship already has data), add a task with a random
   title, press the header sync button.
2. Check the hub: the store list API lists `super-productivity/sync-data.json`,
   a `PROPFIND Depth:1` from the page (through the shim) returns 207 with the
   files, and the task title is inside a stored file.
3. Context B (new empty profile, logged in): open the app, auto sync and a
   manual sync; the task shows up in Today.
4. Sequential conflict (A stays open): A adds a task and syncs; B adds a task
   and syncs without pulling first. The ship's `sync-data.json` must hold both,
   and both clients show both after a sync.
5. Forced race: B's next `PUT sync-data.json` (with `If-Match` of the rev it
   just read) is held in the page while A adds a task and syncs. Then B's PUT
   is released and must get `412` from the server; the ship must still hold
   A's task; B's sync button must not show an error. After one more sync of B
   and A, the ship and both clients have both tasks. The held PUT is sent from
   node on its own connection (via `exposeFunction`) and its real response is
   handed to SP, to avoid the mock's keep-alive desync after a 412.

Fails on page errors, console errors, failed requests, any external request and
any 4xx/5xx from the ship, except `GET` 404s under `/utilities/dav/superprod/`
(SP probes for files that may not exist yet) and, during step 5 only, the
expected 412 and SP's "Concurrent upload detected" console errors.

Result: PASS against the mock (`kit/serve.py`), both with an empty store and with
data from earlier runs (steps 4 and 5 included, observed: 412 on the held PUT, no
dialog, merged on the next sync). `node kit/pwa-check.js superprod`: `errors=[]`, SW
scope `/superprod/`.

The test does not delete anything on the ship. Against a real ship with
existing SP data it adds five tasks ("ship sync test ...", "ship conflict a/b
...", "ship race a/b ...") to the user's data.

## Limitations

- When device B first syncs, SP asks with a native `confirm()` whether to
  overwrite local data with the remote data (upstream behavior for a fresh client).
- If the ship cookie expires, the Angular service worker still serves the cached
  app, but sync fails with 401/403 and SP shows a WebDAV auth error. Logging in
  to the ship again fixes it. There is no password field to fix in SP.
- Features that need the internet keep working only with internet access and
  are opt-in: issue-provider integrations (Jira, GitHub, GitLab, CalDAV, ...),
  Unsplash backgrounds (no API key in this build), Dropbox, OneDrive and
  SuperSync providers.
- The SP sync format is SP's own (`sync-data.json` and friends). It's stored
  unencrypted on the ship unless the user enables SP's end-to-end encryption in
  Settings > Sync.
