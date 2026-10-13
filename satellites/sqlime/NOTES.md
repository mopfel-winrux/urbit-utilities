# sqlime

- Upstream: https://github.com/nalgeon/sqlime
- Version: commit `7c06bfbb403f549b2fbae112177aaf20785459f6` (main, 2025-09-04; the last tag, 3.37.2, is years older). The SQLite engine is the vendored sqlean wasm (`js/sqlite/sqlean.wasm`, SQLite 3.47.0), already in the repo, so nothing comes from a CDN.
- License: MIT
- No build step: plain static HTML/JS. build.sh pins, patches and copies. Served at `/sqlime/`, hash state (`#employees.db`), `spa=|`.
- Size of `desk/web`: 2.3 MB, 62 files

## Patches (`patches/urbit.patch`)
- Absolute `/img/…`, `/site.webmanifest` and `/` links are now relative, so the app works under `/sqlime/`.
- **Gist sharing hidden**: removed the "share" button (GitHub Gist save), the Ctrl+S shortcut, the "visit settings to enable sharing" hint and the settings page, which only held a GitHub token and an OpenAI key.
- **"Ask AI" (OpenAI API) removed**.
- The manifest gets a name and short_name. `kit/pwa.py` adds the 192 and 512 icons, scope and the kit service worker.
- `kit/marks.py`: added `db` (the bundled demo databases).

## Tested
- `test.js` opens `/sqlime/#employees.db` (bundled), runs `select count(*), sum(salary), sqlite_version() from employees` and checks the result row `10 | 942 | 3.x`. On a fresh in-memory database it runs create, insert and `select group_concat, sum` and checks `2+3+5 | 10`. No page errors and no external requests.
- `kit/pwa-check.js sqlime` prints `errors=[]`.

## Known issues
- "open url" (load a database from a remote URL) and opening an existing `#gist:<id>` link need the internet. They only run when the user acts.
- OPFS persistence is off (a console warning) because the ship sends no COOP/COEP headers. Databases live in memory: open a file to load one. The query text is saved in localStorage.
