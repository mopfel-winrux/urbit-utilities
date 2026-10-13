# Enclosed satellite (`%enclosed`)

- Upstream: https://github.com/CorentinTh/enclosed, tag `v1.9.2` (commit f3e4c4e).
  Only `packages/app-client` (SolidJS + Vite) and `packages/lib` (crypto) are built.
- License: Apache-2.0 (redistribution allowed; LICENSE is in the upstream repo).
- Size: 110 files, 1.9 MB (84 of them are vendored Inter font subsets, 1.5 MB).
- Build: `./build.sh` clones the tag into `upstream/`, resets it to the tag, applies
  `patches/urbit.patch`, runs `pnpm@9.12.2 install --frozen-lockfile` (via npx) and
  `vite build`, copies `dist` to `desk/web`, adds `icon.svg` (upstream logo), then
  runs `kit/pwa.py`, `kit/claysafe.py`, `kit/marks.py` and `kit/check.py`. Idempotent;
  verified from an empty `upstream/`.

## How it uses the hub

The upstream server (`/api/notes`) is gone. `src/modules/notes/notes.services.ts`
is replaced; the UI and the crypto (`@enclosed/lib`, AES-256-GCM, key in the URL
fragment) are upstream's.

| action | request |
|---|---|
| create (owner, needs login) | `PUT /utilities/api/store/enclosed/notes/<id>` with `content-type: application/json`, `x-utilities-public: true`, `x-utilities-expires: <now + ttl, unix ms>` (always set: 1h/1d/1w/1m as chosen), and `x-utilities-burn: true` when "delete after reading" is on. Body: `{"payload","encryptionAlgorithm","serializationFormat","deleteAfterReading"}` (ciphertext only). |
| burn check before reading | `HEAD /utilities/pub/enclosed/notes/<id>` (200 = exists, 404 = gone). Relies on HEAD not burning. |
| read (anyone, no login) | `GET /utilities/pub/enclosed/notes/<id>` (`credentials: omit`) |

- `<id>` is a client-generated ULID (26 Crockford base32 chars), so it matches
  upstream's note-id route filter.
- Note link: `<origin>/enclosed/v/<id>#[pw:][dar:]<key>`. The key (and the
  password, if any) never reach the ship; the stored body has only ciphertext.
- Password protection is signalled by the `pw:` fragment, as upstream does.
- A 401 from the store on create shows "Creating notes requires logging in to your
  Urbit ship (/~/login)".

## Fileserver config

- `auth` is `|` (whole desk public) and `spa` is `&` (history routing; the viewer
  is the route `/enclosed/v/<id>`). Public is needed so anonymous visitors can load
  the viewer page, its assets, the manifest and `sw.js`. The create page is
  therefore also visible without login, but it cannot store anything: the hub
  API returns 401. Nothing private lives under `/enclosed/`.
- PWA: kit manifest and service worker (`kit/pwa.py`); they work without the cookie
  because the desk is public. `kit/pwa-check.js enclosed` reports `errors=[]`.

## Patches (`patches/urbit.patch`)

- `vite.config.ts`: `base: '/enclosed/'`; lowercase hex hashes and lowercase chunk
  names (clay-safe file names without renaming).
- `src/index.tsx`: router `base` = `/enclosed`. `src/routes.tsx`: viewer at `/v/:noteId`.
- `notes.services.ts`: hub API (above). `notes.usecases.ts`: builds the `/enclosed/v/` link.
- `uno.config.ts`: `presetWebFonts` uses unocss' local font processor, so Inter is
  downloaded at build time into `assets/fonts/` instead of loaded from fonts.bunny.net.
- `index.html`: drop the `site.webmanifest` link (kit/pwa.py makes the manifest);
  `public/site.webmanifest` removed. `en.json`: login hint for the 401 message.

## Tested (`test.js`, mock ship on :8206)

Logs in like `test/e2e.js`, creates a note with a password and burn-after-reading,
checks the link shape, checks the hub list (`GET /utilities/api/store/enclosed/?prefix=notes/`)
shows it public + burn + expiry and that the stored body holds neither plaintext
nor key. In a fresh incognito context: anonymous `PUT` to the store gets 401
(expected), the link shows the burn warning, then the password prompt, and the
note decrypts to the original text. In a second incognito context the link shows
"note not found" and the public URL returns 404 (expected), and the note is gone
from the store list. Fails on page errors, any non-same-origin request, and
unexpected 4xx/5xx. Result: PASSED.

## Limitations

- Upstream's own login (`isAuthenticationRequired`) and the CLI/API integration are
  unused; the ship login is the only auth.
- Burn happens on the first GET of the public URL, as the hub does it. If the
  visitor then types a wrong password they can retry (the ciphertext stays in
  memory), but reloading the page shows "not found".
- File attachments are encrypted into the same payload; the size limit is whatever
  the hub/Eyre accepts for one PUT (no 413 handling beyond a generic message).
- WebCrypto needs a secure context: over plain HTTP on a non-localhost ship the
  app shows upstream's "insecure connection" warning and cannot encrypt/decrypt.
- Expired notes: the list API and `pub` hide them; they are not actively deleted
  by the client.
- Header links (GitHub, docs, buymeacoffee) still point to upstream sites; they are
  only followed when clicked.
