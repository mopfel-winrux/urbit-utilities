# Adding an app to the %utilities store

Instructions for an agent (or a person) adding a new app ("satellite") to the
store. Read `kit/CONTRACT.md` too: it is the authoritative spec for the desk
layout, the hub HTTP API and the tests. This file is the procedure.

## What makes a good satellite

- **It runs entirely in the browser.** The ship only serves static files. Tier 1
  apps need nothing else. Tier 2 apps save state on the ship through the hub
  API (`/utilities/api/store/...`) or WebDAV (`/utilities/dav/...`).
- **It works offline.** No CDNs, analytics, web fonts or telemetry at runtime;
  vendor everything. Features that inherently need the internet (Nostr relays,
  MQTT brokers) are fine, but say so in `NOTES.md`.
- **The licence allows redistribution.** Record it in `NOTES.md`, and flag
  anything non-commercial or otherwise restricted.
- **Size is reasonable.** Under 50 MB is easy. 100 MB or more works, but the
  publisher then needs `--loom 33` to commit it. Mention big desks in your
  report.

If the app needs a server process (a database, an API backend, server-side
rendering), it doesn't fit as-is. Either it has a client-only mode, or its
server part can be replaced by the hub store or WebDAV. Otherwise report that
it's not a fit; don't fake it.

## Procedure

Work in `satellites/<desk>/`. The desk name is lowercase `[a-z][a-z0-9-]*`
and is also the URL: `/<desk>/`.

1. **Scaffold the desk.**
   `kit/new-satellite.sh <desk> "<Title>" "<one-line info>" [spa] [auth]`
   - `spa`: `&` for apps that use history routing (unknown paths serve
     `index.html`). Leave it `|` for hash routing.
   - `auth`: `&` (login required, the default), `|` (public), or
     `[& ~[[/share |]]]` (public only under `/<desk>/share`).
   - Only `app/fileserver/config.hoon` and the docket may differ from the kit.
     Don't edit the fileserver agent.
2. **Write `build.sh`.** It must reproduce `desk/web/` from a clean clone:
   - Fetch a pinned upstream (a tag, a commit, or a tarball checked with
     `sha256sum`) into `upstream/`, which is gitignored.
   - Apply your changes from `patches/*.patch` or a `patch.py`. Reset
     `upstream/` first so reruns are idempotent.
   - Build with Node 22. Use `npx -y pnpm@X` / `yarn@X` / `bun@1` for other
     package managers, pinned.
   - Copy the output to `desk/web/`, plus `desk/web/icon.svg` (or `icon.png`)
     for the tile.
   - Then run, in this order:
     ```sh
     python3 kit/pwa.py desk          # manifest, icons, service worker
     python3 kit/claysafe.py desk/web # rename files Clay can't store
     python3 kit/marks.py desk        # a mark for every file extension
     python3 kit/check.py desk        # must print OK
     ```
   - Copy an existing `build.sh` as a starting point. `satellites/sqlime`
     (small) and `satellites/excalidraw` (patches and a yarn build) are good
     examples.
3. **Make it work under `/<desk>/`.**
   - Set the bundler's base path. Every URL must be relative or prefixed with
     the base.
   - Clay only stores path segments matching `[a-z0-9-._~]`, and every file
     needs an extension. Prefer bundler options (lowercase hashed names)
     over relying on `claysafe.py`.
   - Remove or disable every external request.
4. **Tier 2 only: save to the ship.** Use the hub API from `kit/CONTRACT.md`,
   on the same origin with the login cookie:
   - Remember the `ETag` of what you loaded. Save with `If-Match: <etag>`
     (or `If-None-Match: *` for a new file).
   - On `412`, never overwrite silently. Show a choice: overwrite, save as a
     copy, or load theirs.
   - Large files can be read in slices with `Range`.
   - For WebDAV clients, vendor `kit/shim.js` and load it before the app. It
     tunnels PROPFIND, MOVE and the other WebDAV methods through POST.
   - Public links (no login) go through `/utilities/pub/...`.
   - See `satellites/excalidraw` (store API), `satellites/jupyter` (WebDAV)
     and `satellites/enclosed` (public burn-after-reading links).
5. **Write `test.js`.** It's a puppeteer test that logs in like
   `test/e2e.js`, does one real thing in the app, and asserts on the result.
   - It reads `BASE_URL`, `SHIP_CODE` and `CHROME` from the environment.
   - It exits non-zero on failure, on any page error, and on any failed or
     4xx/5xx request to the ship.
   - Log in with `${BASE}/~/login?redirect=/utilities/icon.svg` so the test
     doesn't land on Landscape.
6. **Write `NOTES.md`.** Include:
   - the upstream repo and the pinned version;
   - the licence;
   - what you patched and why;
   - the API calls it makes (tier 2);
   - what doesn't work;
   - the build size;
   - how the test works.
7. **Register it.** Add an entry to `catalog.json`:
   `{"desk", "title", "info", "category", "tier"}`. Then run
   `python3 hub/gen-catalog.py`.

## Testing

Test against the mock ship first. It implements the fileserver and the whole
hub API in memory, with the same semantics as a real ship.

```sh
python3 kit/serve.py --port 82NN        # pick a free port
cd satellites/<desk>
BASE_URL=http://localhost:82NN SHIP_CODE=any CHROME=/path/to/chrome node test.js
BASE_URL=http://localhost:82NN node ../../kit/pwa-check.js <desk>   # must print errors=[]
```

If you were given a fake ship (for example `~nus` on port 8098 in tmux
`fake-nus`), deploy and test there too:

```sh
tools/ship-deploy.sh <desk> satellites/<desk>/desk fake-nus ./nus
python3 tools/verify-served.py http://localhost:8098 "$(cat .ship-cookie)" <desk>
tools/run-tests.sh http://localhost:8098 "$(cat .ship-code)" <desk>
```

## Rules

- **Stay in your own directory.** Only touch `satellites/<desk>/` and your
  `catalog.json` entry. If you think `kit/`, `hub/` or the contract needs a
  change, say so in your report instead of making it.
- **Ships.** Never touch ships, tmux sessions or ports you weren't given. A
  user's real ship is theirs to publish to: use `tools/publish.sh` only when
  asked.
- **Report honestly.** Report what you verified and what you didn't. A
  feature you couldn't test is "untested", not "works".

## Done means

- `./build.sh` from a clean clone produces `desk/web/`, and `kit/check.py`
  says OK.
- `test.js` passes on the mock (and on the fake ship, if you had one).
- `pwa-check` prints `errors=[]`.
- `NOTES.md` is complete, the app is in `catalog.json`, and
  `hub/gen-catalog.py` has been run.
- Your report lists: files changed, the desk size, test output, licence
  caveats, and what doesn't work.
