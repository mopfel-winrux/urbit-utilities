# %utilities contract

This is the contract between the `%utilities` hub, its satellite desks and
the mock ship (`kit/serve.py`). The mock implements exactly this; the Hoon
hub agent must match it. If you need something that isn't here, say so in
your report rather than inventing an endpoint.

## Satellites

- One desk per app. The desk name is also the web root: desk `%cyberchef` is
  served at `/cyberchef/` by its own `%cyberchef-fileserver` (kit fileserver,
  unmodified apart from `app/fileserver/config.hoon`).
- Layout in this repo: `satellites/<desk>/`
  - `build.sh`: reproducible, fetches or clones the upstream into `upstream/`
    (gitignored), patches and builds it, and writes the result to `desk/web/`.
    Running it from a clean checkout must reproduce `desk/web/`.
  - `desk/`: scaffolded by `kit/new-satellite.sh`. `web/` must include
    `icon.svg` (or png): it is the app's icon in the hub launcher and its PWA
    icon. Satellites have no `desk.docket-0`, so no Landscape tile of their
    own; the hub is the only entry point.
  - `test.js`: puppeteer smoke test that does one real thing in the app (see
    the testing section below).
  - `NOTES.md`: upstream repo, version or commit, license, what was patched,
    what doesn't work.
- Constraints:
  - Every path segment must match `[a-z0-9-._~]+` and every file needs an
    extension. Fix this at build time (bundler options) rather than by renaming
    afterwards wherever possible.
  - All URLs must work under `/<desk>/`, using relative or base-prefixed paths.
  - No external network requests at runtime: no CDNs, analytics, fonts or
    telemetry. Vendor everything. Features that inherently need the internet
    (for example Nostr relays) are fine, but say so in NOTES.md.
  - `spa=&` in the config makes unknown extensionless paths serve the root
    `index.html` (history-routing apps). Hash routing needs nothing.
  - Fileserver `auth`: `&` = login required (default). `|` = public.
    `[& ~[[/share |]]]` = public only under `/<desk>/share`.
  - Every satellite must be an installable PWA scoped to `/<desk>/`. In
    `build.sh`, run `kit/pwa.py desk` after the app is in `desk/web` and
    before claysafe, marks and check. It needs `web/icon.svg` or
    `web/icon.png`. It normalizes or creates the manifest (start_url, scope and
    id set to `/<desk>/`, 192 and 512 PNG icons with purpose `any`), adds
    `crossorigin="use-credentials"` to the manifest link (otherwise the
    browser fetches it without the login cookie and gets a 403), and installs
    `kit/pwa-sw.js` as `/<desk>/sw.js` unless the app registers its own
    service worker. If the app has its own worker, make sure it registers
    under `/<desk>/` and doesn't cache login redirects. Verify with
    `node kit/pwa-check.js <desk>` (env `BASE_URL`, `CHROME`); it must report
    `errors=[]`.
  - Run `kit/marks.py desk` then `kit/check.py desk`; both must pass.

## Hub HTTP API (agent `%utilities`)

The hub UI is served by `%utilities-fileserver` at `/utilities/`. The agent
binds three prefixes. `<app>` is the satellite's desk name. `<path>` is one
or more URL-encoded segments. (Eyre keeps its bindings sorted so that a
longer path is tried before its prefix, so `/utilities/api` reaches the agent
while everything else under `/utilities` reaches the fileserver.)

### `/utilities/api/*` (login required, otherwise `401`)

| method | path | body / headers | result |
|---|---|---|---|
| GET | `/utilities/api/catalog` | | `{"publisher":"~nus","apps":[{desk,title,info,category,tier,href,status}]}` with status `installed`, `installing`, `suspended` or `available` |
| POST | `/utilities/api/install` | `{"desk":"cyberchef"}` | `202 {"ok":true}`, installs from the publisher. `400` if the desk is malformed or not in the catalog. The ship also answers `404` when the publisher is the ship itself and it has no such desk |
| POST | `/utilities/api/uninstall` | `{"desk":"cyberchef"}` | `202 {"ok":true}`. `400` as for install |
| POST | `/utilities/api/publisher` | `{"ship":"~zod"}`, or `{"ship":null}` to go back to the default | `200 {"publisher":"~zod"}` (the effective publisher). `400` for a bad ship. The default is the ship the `%utilities` desk itself syncs from, else the ship itself |
| GET | `/utilities/api/store/` | | `200` JSON array `[{app,count,size}]`: apps that hold at least one (live, non-collection) item, sorted by name |
| GET | `/utilities/api/store/<app>/` | optional `?prefix=dir/` | `200` JSON array `[{path,type,size,modified,public,burn,expires}]`, recursive. `modified` and `expires` are unix ms, `expires` may be null |
| GET/HEAD | `/utilities/api/store/<app>/<path>` | | the bytes, with `content-type` set to the stored type. `404` if missing |
| PUT | `/utilities/api/store/<app>/<path>` | raw body. `content-type` is stored (default `application/octet-stream`). Optional headers: `x-utilities-public: true`, `x-utilities-burn: true` (delete after the first public read), `x-utilities-expires: <unix ms>` | `200 {"path","public_url"}`. `public_url` is null unless public |
| DELETE | `/utilities/api/store/<app>/<path>` | | `204` (also when it's already gone) |
| POST | `/utilities/api/store/<app>/<path>` | JSON with any of `public` (bool), `burn` (bool), `expires` (unix ms or null) | `200 {"path","public_url"}`: changes the flags without re-uploading; `modified` is unchanged. `404` if missing, `400` for a non-object body |

On the ship, responses are sent chunked (no `content-length`), and HEAD
responses carry the headers without a length.

### ETags, conditional requests and Range (store, dav and pub)

- Every whole-body GET/HEAD of an item carries `ETag` (a strong tag of the
  content: `"<first 16 hex of sha1>"`) and `Accept-Ranges: bytes`. PUT
  responses (API and WebDAV) carry the new item's `ETag`.
- `If-None-Match` on GET/HEAD: `304` with the `ETag` when it names the
  current tag (or is `*`).
- Writes (PUT, DELETE and the flags POST on `/api/store`, PUT and DELETE on
  `/dav`) honour `If-Match` (`412` unless it names the current tag, or is
  `*` and the item exists) and `If-None-Match` (`412` if it names the current
  tag, so `If-None-Match: *` means "create only"). Lists and `W/` prefixes
  are accepted. Editors should send `If-Match` with the tag they loaded so
  that a save never silently overwrites someone else's.
- `Range: bytes=a-b`, `bytes=a-` and `bytes=-n` (one range) answer `206` with
  `Content-Range: bytes a-b/total` and just those bytes. A range that starts
  past the end answers `416` with `Content-Range: bytes */total`. Several
  ranges, or anything malformed, get the whole body (`200`). `206` responses
  carry no `ETag`, so reading a large item in slices doesn't hash all of it
  every time. The total size is in `Content-Range` (or in the store listing).
- On `/pub`, a burn item is deleted once any content has gone out, including
  a `206`. `304` and `416` don't burn.

### `/utilities/pub/<app>/<path>` (no login)

GET or HEAD only. This serves an item only if it is public and not expired.
A `burn` item is deleted after it has been served once by GET (HEAD never burns, so clients can check existence). Anything else gets
`404`. Responses carry `cache-control: no-store`.

### `/utilities/dav/<app>/<path>` (WebDAV, login required)

This is the same namespace as `/api/store`, so `dav/foo/a.txt` and
`api/store/foo/a.txt` are the same item.

- GET, HEAD, PUT and DELETE work natively. OPTIONS returns `DAV: 1,2` and an
  `Allow` header.
- Vere drops every other method with a `400`, so PROPFIND, PROPPATCH, MKCOL,
  COPY, MOVE, LOCK and UNLOCK are sent as `POST` with
  `X-HTTP-Method-Override: <METHOD>`. A POST without the override header gets
  `405`.
- Collections are implicit: a path prefix of any item is a collection. MKCOL
  stores a marker so empty collections exist. Deleting a collection deletes
  everything under it.
- PROPFIND: `Depth: 0` or `1` (`infinity` is treated as 1). The response is
  `207` with `application/xml; charset=utf-8`, a `D:multistatus` in namespace
  `DAV:`, and one `D:response` per resource. Each response has an `href` (the
  absolute path, percent-encoded, with a trailing `/` for collections) and the
  props `displayname`, `resourcetype` (`<D:collection/>` or empty),
  `getcontentlength`, `getcontenttype`, `getlastmodified` (RFC 1123 GMT),
  `getetag` and `creationdate`. A missing resource gets `404`.
- COPY and MOVE take a `Destination` header (an absolute URL or a path) and
  `Overwrite: T|F`. They return `201` for a new destination, `204` when they
  overwrite, and `412` when `Overwrite: F` and the destination exists.
- LOCK returns `200` with a dummy `opaquelocktoken` in a `Lock-Token` header
  and an `activelock` body. UNLOCK returns `204`. PROPPATCH returns `207` and
  accepts every property.

### Method-override shim

Satellites that use WebDAV vendor `kit/shim.js` into `web/` and load it
before the app. It patches `fetch` and `XMLHttpRequest`: any request to a
path containing `/utilities/dav/` with a method other than GET, HEAD, PUT,
POST, DELETE or OPTIONS is sent as POST with `X-HTTP-Method-Override`.

## Testing

- Run `python3 kit/serve.py --port <yours>`. It serves every
  `satellites/*/desk/web` at `/<desk>/` and the hub at `/utilities/`, with
  fileserver semantics and the API above, all in memory.
- Login matches the ship: GET `/~/login` shows a password form, POST sets
  `urbauth-~nus`, and any password works. Protected routes return `403`
  without the cookie and `/utilities/api` returns `401`.
- `test.js` reads `BASE_URL` (default `http://localhost:<port>`), `SHIP_CODE`
  and `CHROME` from the environment. It logs in exactly like
  `test/e2e.js`, does the action, asserts on the result, and exits non-zero on
  failure or on any page error or failed request to the ship. The same test
  will be run against the real ship.
