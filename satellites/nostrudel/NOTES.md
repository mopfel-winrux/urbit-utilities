# noStrudel on Urbit (`%nostrudel`)

- Upstream: https://github.com/hzrd149/nostrudel, tag `v1.1.0` (commit `646d0e7abbef8e49b91b0c0d65a5f8bf36be9619`)
- License: MIT
- Build: `./build.sh` (pnpm 9.14.4 via npx, Node 22). Resets `upstream/` to the tag, applies
  `patches/urbit.patch`, vendors Font Awesome 4.7 (npm tarball, sha256-checked), builds with
  `VITE_BASE=/nostrudel/`, copies `dist` to `desk/web`, then runs the kit pwa/claysafe/marks/check.
- Size of `desk/web`: about 10 MB (159 files).
- Desk config: `spa=&` (history routing), `auth=&`.

## Patches (`patches/urbit.patch`)
- `vite.config.ts`: no source maps; manifest icon and protocol-handler URLs made relative
  (start_url/scope/id are set to `/nostrudel/` by `kit/pwa.py`).
- `src/app.tsx`: router `basename` from `import.meta.env.BASE_URL`.
- Hard-coded `/apple-touch-icon.png` and `/logo.svg` image paths now use the base path.
- Default `loadOpenGraphData: false` (link previews fetched every linked page directly from the browser).
- Event cache fallbacks start with the in-browser IndexedDB cache instead of probing a
  `ws://localhost:4869` relay on the user's machine (which logged connection errors on every load);
  the local relay can still be selected in Settings > Cache.
- Wiki markdown editor (EasyMDE): `spellChecker: false` and `autoDownloadFontAwesome: false`
  (both downloaded from CDNs: jsdelivr dictionaries, maxcdn Font Awesome); Font Awesome 4.7 is vendored
  (woff2/woff only).
- Build script removes `public/.well-known/nostr.json` (nostrudel.ninja's NIP-05 file).

noStrudel ships its own Workbox service worker (`/nostrudel/sw.js`, scope `/nostrudel/`), kept as is:
it precaches the build when installed (the precache fetch carries the login cookie and fails on a non-OK
response, so login pages are not cached) and serves the cached `index.html` for navigations.

## Tested (`test.js`, mock ship on :8204)
Logs in via `/~/login`, opens `/nostrudel/`, waits for "Welcome to noStrudel", opens the private-key
sign-in, clicks "Generate New" (a new nsec is generated locally), signs in with it, and checks that the
account is persisted and the welcome screen is gone. Fails on page errors and any 4xx/5xx from the ship.
Passes. `kit/pwa-check.js nostrudel`: `errors=[]`.

## External connections that remain (inherent to Nostr)
- WebSocket connections to Nostr relays: defaults `relay.primal.net`, `relay.damus.io`,
  lookup relay `purplepag.es`, plus users' own relays.
- Media loaded directly from the URLs in notes, NIP-05 lookups to users' domains, relay favicons/NIP-11 info.
- User-triggered only: `api.nostr.band` (user stats panel, trending profiles at the end of sign-up),
  media uploads (`nostr.build` by default, or Blossom servers), map tiles from `tile.openstreetmap.org`
  on map views, embedded players (YouTube via youtube-nocookie, SoundCloud, Tidal...), wallet connections.

## Known issues
- `tsc` type-check step of upstream's `build` script is skipped (vite build only).
