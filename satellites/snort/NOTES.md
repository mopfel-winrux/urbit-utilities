# Snort on Urbit (`%snort`)

- Upstream: https://github.com/v0l/snort, tag `v0.5.3` (commit `f3a6e73e7f8dbb2357a3c770a67d7ca4fbc63da4`)
- License: MIT
- Build: `./build.sh` (bun 1.x via npx, Node 22). Resets `upstream/` to the tag, applies
  `patches/urbit.patch`, builds all workspace packages with `NODE_CONFIG_ENV=urbit`, copies
  `packages/app/build` to `desk/web`, then runs `kit/pwa.py`, `kit/claysafe.py`, `kit/marks.py`, `kit/check.py`.
- Size of `desk/web`: about 9.3 MB (123 files).
- Desk config: `spa=&` (history routing, deep links such as `/snort/settings/keys` work), `auth=&`.

## Patches (`patches/urbit.patch`)
- `vite.config.ts`: `base: "/snort/"`, no source maps, removed the bundle visualizer and the
  vite-plugin-pwa service worker (it precached and runtime-cached third-party image proxy / API
  responses). The kit service worker (`kit/pwa.py`) is installed instead, scoped to `/snort/`.
- `src/index.tsx`: router `basename: "/snort"`.
- `config/urbit.json` (new, a copy of `default.json`): `features.analytics=false`
  (no pageview / event POSTs to `pa.v0l.io`), `features.pushNotifications=false`
  (no web-push registration with `api.snort.social`), icon path under `/snort/`.
- Default preferences: `telemetry: false`, `autoTranslate: false` (translation goes through
  `api.snort.social`), `imgProxyConfig: undefined` (images are no longer rewritten through
  `imgproxy.v0l.io`; users can set an image proxy in Settings).
- `defaultAvatar()` always returns the bundled nostrich image instead of
  `nostr-rs-api.v0l.io/avatar/...`.
- Link previews disabled (they were fetched through `nostr-rs-api.v0l.io`); links render as plain links.
- `public/snort/manifest.json`: `web+nostr` protocol handler URL under `/snort/`.
- Build script removes host files that are not part of the app (`_headers`, `.well-known/`, `nostrich_orig.jpeg`).

## Tested (`test.js`, mock ship on :8204)
Logs in via `/~/login`, opens `/snort/`, waits for the main layout, goes through Sign up
(name, then profile image step) which generates a new key pair locally, then opens
`/snort/settings/keys` and checks the npub and private-key section of the new account. Fails on
page errors and any 4xx/5xx from the ship. Passes. `kit/pwa-check.js snort`: `errors=[]`.

## External connections that remain (inherent to Nostr)
- WebSocket connections to Nostr relays: defaults `relay.snort.social`, `nostr.wine`,
  `relay.damus.io`, `nos.lol`, plus relays discovered from users' relay lists (outbox model),
  and search relays when searching.
- Media (avatars, images, video) loaded directly from the URLs in notes (e.g. `blossom.primal.net`,
  `i.nostr.build`), and NIP-05 verification fetches to each user's domain (`/.well-known/nostr.json`).
- The BTC/fiat rate shown in the header and trending notes come over relays/DVMs.
- User-triggered only: trending users/hashtags widgets (`api.nostr.band`), media upload
  (Blossom servers such as `blossom.band`), Tidal oEmbed lookup for Tidal links, embedded players
  (YouTube, Spotify, etc.) when a note contains such a link, wallet connections (NWC, Alby OAuth),
  Snort's paid services (NIP-05 handles, donations, subscriptions at `api.snort.social`).

## Known issues
- Push notifications are disabled (the feature needs Snort's push service and its own service worker).
- No offline relay: the worker relay (sqlite wasm in a web worker) works as a local cache only.
