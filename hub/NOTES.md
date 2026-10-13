# %utilities hub

The `%utilities` desk is the launcher and data hub for the satellite desks. It
has two agents:

- `%utilities-fileserver`: the kit fileserver (unmodified) serving `web/` at
  `/utilities/` (login required).
- `%utilities` (`app/utilities.hoon`): the catalog, install/uninstall, the
  per-app blob store, public links and WebDAV, as specified in
  `kit/CONTRACT.md`. `kit/serve.py` implements the same contract.

## Layout

```
hub/
  desk/                  the %utilities desk (sys.kelvin [%zuse 408])
    app/utilities.hoon   the agent
    app/utilities-fileserver.hoon, app/fileserver/config.hoon
    sur/utilities.hoon   $item and $state-0
    lib/utilities.hoon   url/header/time/xml/response helpers (mirror the mock)
    lib/utilities-catalog.hoon   GENERATED from ../catalog.json
    web/                 the UI (vanilla HTML/JS/CSS, no build step)
      icons/             optional <desk>.svg / <desk>.png, plus generated index.json
  gen-catalog.py         catalog.json -> lib/utilities-catalog.hoon, icons/index.json
  deploy.sh              gen-catalog + marks + rsync into nus/utilities + |commit + build check
  test-api.sh            curl contract tests (mock and ship)
  test-ui.js             puppeteer UI test (mock and ship)
```

## Routing

Eyre keeps bindings sorted (`+insert-binding` in `sys/vane/eyre.hoon`): a path
that extends another sorts before it, and the first match wins. So binding
`/utilities/api`, `/utilities/dav` and `/utilities/pub` in the agent while the
fileserver binds `/utilities` behaves as longest-prefix routing. I checked this
on `~nus`: `/utilities/` is served by the fileserver and `/utilities/api/*`
reaches the agent. The contract layout didn't need to change.

The agent parses `url.request` itself: it splits on `/`, percent-decodes each
segment and does not lowercase extensions. It doesn't use eyre's parsed path,
which splits the extension off.

## State

```hoon
+$  item     [type=@t data=octs modified=@ud public=? burn=? expires=(unit @ud) dir=?]
+$  state-0  [%0 store=(map @t (map @t item)) publisher=(unit ship) pending=(map desk @da)]
```

Items live in agent state, as the user chose; nothing goes to Clay. They are
keyed app -> path, where the path is the decoded segments joined with `/`.
Times are unix ms, as in the API. `dir` marks an empty WebDAV collection made
by MKCOL. Expired items are hidden everywhere but are not swept.

## Endpoints

These are all as in `kit/CONTRACT.md`. In summary:

- `GET /utilities/api/catalog`: `{publisher, apps:[catalog fields... , href, status]}`.
  Unknown catalog fields pass through.
- `POST /utilities/api/install|uninstall {"desk"}` -> `202`. Pokes `%hood`.
- `POST /utilities/api/publisher {"ship":"~zod"|null}` (new).
- `GET /utilities/api/store/` -> `[{app,count,size}]` (new, for the Storage view).
- `GET|HEAD|PUT|DELETE /utilities/api/store/<app>/<path>`, `GET .../<app>/?prefix=`.
- `POST /utilities/api/store/<app>/<path> {public?,burn?,expires?}` changes flags
  without re-uploading (new, for the public toggle).
- `GET|HEAD /utilities/pub/<app>/<path>`: public, not expired. A burn item is
  deleted after the first GET (HEAD doesn't burn). `cache-control: no-store`.
- `/utilities/dav/<app>/<path>`: GET/HEAD/PUT/DELETE/OPTIONS natively, and
  PROPFIND/PROPPATCH/MKCOL/COPY/MOVE/LOCK/UNLOCK as POST plus
  `X-HTTP-Method-Override`.

Auth: Eyre passes `authenticated` (an `%ours` session cookie) with every
request. `/api` returns `401` JSON without it. `/dav` returns `401` with
`WWW-Authenticate: Basic`. `/pub` is open.

The PROPFIND/PROPPATCH/LOCK XML is byte-identical to the mock's. I diffed it
after normalizing dates and lock tokens, including UTF-8 names, `&<>"'` in
content types and percent-encoded hrefs. ETags are the first 16 hex digits of
the SHA-1 of the bytes (`sha-1l:sha` on the byte-reversed atom), the same as
the mock's.

## Install and uninstall (kiln)

These come from `nus/base/app/hood.hoon` and `lib/hood/kiln.hoon`:

- Install: poke `[our %hood]` with mark `%kiln-install` and vase
  `[loc=desk her=ship rem=desk]`, here `[desk publisher desk]`. When the
  publisher is the ship itself and the desk exists locally, kiln only sets the
  desk's zest to `%live`, which revives a suspended satellite. For a remote
  publisher, kiln sets the zest to `%held` and starts a sync. Clay revives the
  desk after the first merge lands.
- Uninstall: `%kiln-uninstall` with a `desk`. Kiln sets the zest to `%dead`
  (the desk and its files stay) and drops any sync.
- The agent checks that the desk is in the catalog (`400` otherwise), so the
  hub can never uninstall `%base` or itself. With the publisher set to the
  ship itself, install of a desk that doesn't exist answers `404`, because
  kiln would otherwise try to revive a nonexistent desk.

## Status

Status comes from clay, which is the ground truth (docket derives its charges
from the same data). The agent scries `.^(rock:tire:clay %cx /=//=/tire)` for
each desk's zest, plus kiln's `/kiln/sources` for desks that are syncing but
not yet known to clay:

| condition | status |
|---|---|
| zest `%live` | `installed` |
| zest `%held` (waiting for its first sync or commit) | `installing` |
| no desk yet, but kiln has a sync source for it | `installing` |
| we poked install less than 10 minutes ago (`pending`) and none of the above | `installing` |
| zest `%dead` (uninstalled or suspended; the files are still there) | `suspended` |
| otherwise | `available` |

`pending` covers the time between the poke and kiln acting. A nacked kiln
poke clears it. The UI shows Install for `available` and Reinstall for
`suspended`.

## Publisher

The publisher is the override from `POST /api/publisher`, if set. Otherwise
it's the ship the `%utilities` desk itself syncs from: `.^((map desk [ship desk])
%gx /=hood=/kiln/sources/noun)` at `q.byk.bowl`. Failing both, it's `our`.
`{"ship":null}` clears the override. A scry is also available:
`.^(@p %gx /=utilities=/publisher/noun)`.

## Catalog

`catalog.json` at the project root is the single source of truth.
`python3 hub/gen-catalog.py` validates it (the required fields and the desk
name form) and writes `desk/lib/utilities-catalog.hoon`, which holds the
compact JSON as one cord. The agent parses that at request time and adds
`href` and `status` to each object, so new fields in `catalog.json` reach the
API untouched. To regenerate, run `hub/deploy.sh` (it runs the generator), or
run `gen-catalog.py` and commit. The same script writes `web/icons/index.json`,
the list of icons present in `web/icons/`. The UI uses it so it never requests
an icon that doesn't exist.

## UI (`/utilities/`)

- Apps: installed apps appear as a tile grid, and each tile opens `/<desk>/`
  in a new tab (`target=_blank`). That still works when the hub runs as an
  installed PWA, since `/<desk>/` is outside the hub's scope. Below that is the
  catalog, with search, category chips, and cards showing the title, info,
  category, a "saves to your ship" badge for tier 2, and
  Install/Reinstall/Open/Uninstall. Uninstall asks for confirmation. While a
  desk is installing or uninstalling, the card shows a progress bar and the
  UI polls `/api/catalog` every 2 s until the status flips. After 60 s it says
  it is still waiting for the publisher, and Cancel uninstalls.
- Storage: a list of apps holding data (`GET /api/store/`), then a table per
  app with name, type, size and modified time, a public switch (via the flags
  POST, which copies the link when turned on), Copy link, and Delete with
  confirmation.
- Icons: `/utilities/icons/<desk>.svg` or `.png` if listed in `index.json`.
  Otherwise a letter avatar with a gradient colored by category.
- The theme follows the system light/dark setting, and the moon button cycles
  auto, dark and light (remembered in localStorage). It is responsive down to
  phone width and makes no external requests.
- PWA: `python3 kit/pwa.py hub/desk` wrote `manifest.webmanifest` (scope and
  id `/utilities/`) and the 192 and 512 icons. The hub registers its own
  `sw.js` (scope `/utilities/`). It is network-first for the UI shell and
  static files only, and never intercepts `/utilities/api`, `/dav` or `/pub`,
  so live data and burn reads are never served from a cache.
  `node kit/pwa-check.js utilities` reports `errors=[]` on both the mock and
  `~nus`.

## Testing

```sh
python3 kit/serve.py --port 8210 &
hub/test-api.sh http://localhost:8210 'urbauth-~nus=0vmock'
hub/test-api.sh http://localhost:8098 "$(cat .ship-cookie)"
export PATH=$HOME/.nvm/versions/node/v22.22.0/bin:$PATH
BASE_URL=http://localhost:8210 node hub/test-ui.js
BASE_URL=http://localhost:8098 node hub/test-ui.js    # also uninstalls and reinstalls %vert
```

`test-api.sh` uses a fresh app namespace on every run and cleans up after
itself.

## Known limitations

- Everything lives in agent state, in the loom. A 20 MB PUT/GET takes about
  0.2 s, but each PUT also writes its body to the event log, and the total
  stored data is bounded by the loom size (2 GB by default). This is not meant
  for large archives.
- Ship responses are chunked. An explicit `content-length` makes vere answer
  with length 0, because eyre sends the header fact before the data fact. As
  a result, HEAD has no length.
- Expired items are hidden but never garbage-collected. A burn item is deleted
  on its first public GET.
- LOCK/UNLOCK are dummies (the contract allows this), and PROPPATCH accepts and
  discards every property.
- `installing` for a remote publisher depends on kiln and ames. If the
  publisher never answers, the desk stays `%held`, and so `installing`, until
  the user cancels, which uninstalls it. I only tested install/uninstall with
  publisher = `our` (the `%vert` desk on `~nus`). I haven't run the remote
  path, because `~lud` is reserved.
- Status is per desk, not per agent. A `%live` desk whose agents fail to build
  still shows as `installed`.

## Publishing (learned on ~nus/~lud, 2026-10-12)

- Other ships can only sync a desk the publisher has made public: run
  `|public %<desk>` on the publisher for `%utilities` and every satellite
  (`tools/ship-deploy.sh` does this when it creates a desk). Without it a
  remote `|install` (or an install from the launcher) sits at "beginning
  install" forever.
- Committing BentoPDF (267 MB) or Omni Tools (224 MB) runs a ship with the
  default 2 GB loom out of memory (`bail: meme` while jamming the event). Run
  the publisher with `--loom 33`.
- Reinstalling a desk after an uninstall: kiln marks it `%held` and only goes
  `%live` on the next update, which never comes when the publisher's copy is
  unchanged. `install` therefore also pokes `%kiln-revive` when the desk
  exists locally as `%dead`.
