# MQTTX Web on Urbit (`%mqttx`)

- Upstream: https://github.com/emqx/MQTTX (the `web/` package), tag `v1.13.1`
  (commit `5cf00bfdde761c39fce86a1348cb416311109380`)
- License: Apache-2.0
- Build: `./build.sh` (yarn 1.22.22 via npx with a private cache, Node 22 with
  `--openssl-legacy-provider`; upstream asks for Node 18 so `--ignore-engines` is used). Resets
  `upstream/` to the tag, applies `patches/urbit.patch`, builds with `BASE_URL=/mqttx/`
  (vue-cli publicPath), copies `web/dist` without source maps to `desk/web`, then runs the kit
  pwa/claysafe/marks/check. The kit service worker is installed.
- Size of `desk/web`: about 5.6 MB (35 files).
- Desk config: hash routing, `spa=|`, `auth=&`.

## Patches (`patches/urbit.patch`)
- `src/main.ts`: Google Tag Manager (`@gtm-support/vue2-gtm`, GTM-KHSFXHT) removed. Upstream only
  enables it in its "online" build mode, but it is gone entirely now.
- `src/router/index.ts`: GTM `dataLayer` page-view tracking removed.
- `src/utils/mqttUtils.ts`: new connections default to `wss://` port 8084 when the page is served over
  https (a ship behind TLS cannot open `ws://` sockets), else `ws://` port 8083.

MQTTX Web has no update check or telemetry beyond GTM (the desktop app's update checks are not part of `web/`).

## Tested (`test.js`, mock ship on :8204)
Logs in via `/~/login`, opens `/mqttx/`, clicks "New Connection", fills in a name and the host
`broker.example.org`, picks "Save Only", checks the connection is listed, reloads, and checks it is
still there (stored in localStorage). Fails on page errors and any 4xx/5xx from the ship. Passes.
`kit/pwa-check.js mqttx`: `errors=[]`.

## External connections that remain
- MQTT over WebSocket to the brokers the user configures. The new-connection form is prefilled with
  upstream's public test broker `broker.emqx.io`; nothing connects until the user clicks Connect.
- Links only (About/Help pages): emqx.com, mqttx.app, GitHub, etc.

## Known issues
- Brokers must speak MQTT over WebSockets; plain TCP/TLS MQTT isn't possible from a browser.
- On an https ship, brokers need `wss://` with a valid certificate (browser rule).
