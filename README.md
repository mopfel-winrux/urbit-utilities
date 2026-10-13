# %utilities: an app store of browser apps for Urbit

`%utilities` is a hub desk with a launcher. It lists a catalog of satellite
desks and installs or uninstalls them from its UI. Each satellite is a web
app that runs entirely in the browser (often WebAssembly), served as static
files from its own desk at `/<desk>/`, and installable as a PWA. Tier 2 apps
save their data on the ship, in the hub's agent state, through an HTTP API or
WebDAV.

The 25 apps are VERT, BentoPDF, Omni Tools, Mazanoke, Squoosh, miniPaint,
draw.io, FossFLOW, Mermaid Live, IT Tools, CyberChef, Networking Toolbox,
Sqlime, Typst, MQTTX, Snort, noStrudel, EmulatorJS, js-dos, Excalidraw, Super
Productivity, Enclosed, Office, JupyterLite and Kiwix. See `catalog.json`,
and each `satellites/<desk>/NOTES.md` for licences and caveats.

```
catalog.json        the store's catalog (compiled into the hub by hub/gen-catalog.py)
hub/                the %utilities desk: agent (store, WebDAV, install/uninstall), launcher UI
satellites/<desk>/  build.sh (fetch, patch and build upstream), desk/, test.js, NOTES.md
kit/                satellite template, build helpers, mock ship, CONTRACT.md (the spec)
tools/              build-all, publish, test runner, fake-ship helpers
AGENTS.md           how to add an app to the store
```

## Build and publish to your ship

Do this on the machine that hosts your ship's pier.

You'll need: git, curl, rsync, tar, Python 3 with venv, and Node 22 (for
example `nvm install 22`). Headless Chrome is downloaded automatically if it's
missing. A full build takes about 20 GB of disk and a while.

```sh
git clone https://github.com/mopfel-winrux/urbit-utilities && cd urbit-utilities
tools/build-all.sh                    # builds every satellite, then the hub
tools/publish.sh ~/path/to/pier       # walks you through committing each desk
```

`publish.sh` shows the plan, then for each desk:
1. creates and mounts it (first time only);
2. copies the build in;
3. tells you to `|commit` it;
4. the first time, has you `|public` it, so other ships can install from you,
   and `|install` it.

It prints every dojo command and waits for you. If the ship runs in tmux, add
`--tmux <session>` and it types the commands itself. Re-running it only
re-commits desks that changed.

Start the ship with `--loom 33`. BentoPDF (267 MB) and Omni Tools (224 MB)
crash a commit on the default 2 GB loom (`bail: meme`; nothing is lost, just
restart with the bigger loom).

Once published:
- **You:** open `https://<your-ship>/utilities/`.
- **Other ships:** `|install ~<your-ship> %utilities`, then install apps from
  the launcher. The hub installs satellites from the ship it was installed
  from.

## Develop and test

- **Mock ship, no Urbit needed:** `python3 kit/serve.py --port 8210` serves
  every built satellite and the hub API in memory.
- **Run tests:** `tools/run-tests.sh <base-url> <code> <desk>...` runs each
  app's `test.js` plus the PWA check. `hub/test-api.sh <base-url> <cookie>`
  runs the 211 hub API checks.
- **Fake ships:** `tools/ship-deploy.sh <desk> <dir> <tmux-session> <pier>`
  commits one desk to a local fake ship.
- **Adding an app:** see `AGENTS.md`.
