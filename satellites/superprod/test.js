// Super Productivity on the ship: create a task, sync it to the ship over
// WebDAV (/utilities/dav/superprod/), check the files landed in the hub store,
// then sync from a second, empty browser profile and check the task arrives.
// Then two-client conflicts: A and B both change and sync (B without pulling),
// and a forced race where B's If-Match PUT is held until A has written a newer
// version; it must get 412 and nothing on the ship may be clobbered.
// usage: BASE_URL=http://localhost:8206 SHIP_CODE=... CHROME=... node test.js
const puppeteer = require(process.env.PUPPETEER || '/home/amadeo/Research/vert-urbit/test/node_modules/puppeteer-core');
const BASE = (process.env.BASE_URL || 'http://localhost:8206').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'x';
const APP = `${BASE}/superprod/`;
// letters only: SP's short syntax would eat things like "5m" or "2h"
const TITLE = `ship sync test ${Array.from({ length: 8 }, () => 'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random() * 23)]).join('')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = () => Array.from({ length: 8 }, () => 'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random() * 23)]).join('');
const errs = [];
// during the forced race (step 4) B's stale PUT is expected to get a 412
let race = null;
const expected412 = (r) => race && r.status() === 412 && r.request().method() === 'PUT' &&
  r.url().startsWith(`${BASE}/utilities/dav/superprod/`);

// GETs of not-yet-existing sync files are part of SP's normal sync protocol
const expected404 = (r) => r.status() === 404 && r.request().method() === 'GET' &&
  r.url().startsWith(`${BASE}/utilities/dav/superprod/`);

async function login(page) {
  await page.goto(`${BASE}/~/login?redirect=/utilities/icon.svg`);
  await page.type('input[type=password]', CODE);
  await Promise.all([page.waitForNavigation().catch(() => {}), page.keyboard.press('Enter')]);
}

function watch(page, tag) {
  page.on('dialog', async (d) => { console.log(`${tag}: dialog ${d.type()}: ${d.message().slice(0, 200)}`); await d.accept(); });
  page.on('pageerror', (e) => errs.push(`${tag} pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && race && /status of 412|Precondition|RemoteFileChanged|UploadRevToMatch|Concurrent upload detected/.test(m.text()))
      race.console.push(`${tag} ${m.text().slice(0, 200)}`);
    else if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 404/.test(m.text()))
      errs.push(`${tag} console ${m.text().slice(0, 300)}`);
    if (process.env.VERBOSE) console.log(`  [${tag} ${m.type()}] ${m.text().slice(0, 200)}`);
  });
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(BASE)) errs.push(`${tag} requestfailed ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(BASE) && !/^(data|blob|chrome-extension):/.test(u)) errs.push(`${tag} external request ${u}`);
  });
  page.on('response', (r) => {
    if (expected412(r)) race.got412.push(`${tag} ${r.request().method()} ${r.url()} If-Match ${r.request().headers()['if-match']}`);
    else if (r.status() >= 400 && r.url().startsWith(BASE) && !expected404(r))
      errs.push(`${tag} HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  });
}

// SP keeps other connections open, so "idle" means: no hub request started
// or finished for a while
function trackHub(page) {
  page._hub = { inflight: 0, last: Date.now() };
  const mine = (r) => r.url().includes('/utilities/');
  if (process.env.VERBOSE) page.on('response', (r) => {
    if (!mine(r)) return;
    const h = r.request().headers();
    const cond = ['if-match', 'if-none-match'].filter((k) => h[k]).map((k) => `${k}: ${h[k]}`).join(' ');
    console.log(`  hub ${r.request().method()} ${h['x-http-method-override'] || ''} ${r.status()} ${r.url()} ${cond}${r.headers().etag ? ` -> etag ${r.headers().etag}` : ''}`);
  });
  page.on('request', (r) => { if (mine(r)) { page._hub.inflight++; page._hub.last = Date.now(); } });
  const end = (r) => { if (mine(r)) { page._hub.inflight--; page._hub.last = Date.now(); } };
  page.on('requestfinished', end); page.on('requestfailed', end);
}
async function hubIdle(page, quiet = 2000, timeout = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (Date.now() - page._hub.last > quiet) return;
    await sleep(200);
  }
  throw new Error('hub requests never settled');
}

async function openApp(page) {
  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForSelector('button.sync-btn:not(.is-in-progress)', { timeout: 60000 });
}

async function sync(page) {
  const btn = await page.waitForSelector('button.sync-btn:not(.is-in-progress)', { timeout: 60000 })
    .catch(async (e) => { await page.screenshot({ path: '/tmp/superprod-fail.png' }); throw e; });
  // wait for the sync response so we know the round trip happened
  const done = page.waitForResponse((r) => r.url().includes('/utilities/dav/superprod/'), { timeout: 30000 });
  await btn.evaluate((b) => b.click());
  await done;
  // let the whole sync cycle finish (several requests)
  await hubIdle(page);
  await page.waitForSelector('button.sync-btn:not(.is-in-progress)', { timeout: 30000 });
  if (await page.$('button.sync-btn.is-error')) throw new Error('sync button shows an error');
}

async function addTask(page, title) {
  // the "+" in the header opens the add-task bar
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => b.innerText.trim() === 'add' && b.getBoundingClientRect().top < 60).click());
  const input = await page.waitForSelector('add-task-bar input, add-task-bar textarea', { timeout: 10000 });
  await input.type(title);
  const typed = await input.evaluate((el) => el.value);
  if (typed !== title) throw new Error(`typing was interrupted: "${typed}"`);
  await sleep(800); // the add-task bar debounces its input
  await page.keyboard.press('Enter');
  await sleep(500);
  await page.keyboard.press('Escape');
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 10000 }, title)
    .catch(async (e) => { await page.screenshot({ path: '/tmp/superprod-fail.png' }); throw e; });
  await sleep(1000);
}

async function shows(page, titles, who) {
  await page.goto(`${APP}#/tag/TODAY/tasks`, { waitUntil: 'load' });
  await page.waitForSelector('button.sync-btn:not(.is-in-progress)', { timeout: 60000 });
  await page.waitForFunction((ts) => ts.every((t) => document.body.innerText.includes(t)), { timeout: 30000 }, titles)
    .catch(async (e) => {
      await page.screenshot({ path: '/tmp/superprod-fail.png' });
      const txt = await page.evaluate(() => document.body.innerText);
      throw new Error(`${who} is missing ${titles.filter((t) => !txt.includes(t)).join(', ')}`);
    });
  await hubIdle(page);
}

// the sync file on the ship must hold every title (nothing clobbered)
async function shipHas(page, titles) {
  const txt = await page.evaluate(async () =>
    (await fetch('/utilities/api/store/superprod/super-productivity/sync-data.json', { cache: 'no-store' })).text());
  const missing = titles.filter((t) => !txt.includes(t));
  if (missing.length) throw new Error(`sync-data.json on the ship lost ${missing.join(', ')}`);
}

// send a request captured in the page from node, with Connection: close
function forward(req, cookie) {
  const http = require(BASE.startsWith('https') ? 'https' : 'http');
  const headers = { ...req.headers, cookie, 'content-length': Buffer.byteLength(req.body) };
  return new Promise((resolve, reject) => {
    const q = http.request(new URL(req.url), { method: req.method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: { etag: res.headers.etag || '' }, body: Buffer.concat(chunks).toString() }));
    });
    q.on('error', reject);
    q.end(req.body);
  });
}

async function storeList(page) {
  return page.evaluate(async () => {
    const r = await fetch('/utilities/api/store/superprod/?prefix=super-productivity/');
    return r.json();
  });
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
  let ok = false;
  try {
    // --- device A: create a task and sync it up -----------------------------
    const ctxA = await browser.createBrowserContext();
    const a = await ctxA.newPage(); await a.setViewport({ width: 1300, height: 900 });
    await login(a);
    watch(a, 'A'); trackHub(a);
    await openApp(a);
    await sleep(3000); // initial automatic sync (may ask to download remote data)
    await hubIdle(a, 5000);
    await addTask(a, TITLE);
    console.log(`A: created task "${TITLE}"`);
    await sync(a);

    // the files are in the hub store (same namespace as the DAV tree)
    const rows = await storeList(a);
    console.log(`store: ${rows.map((r) => `${r.path} (${r.size} B)`).join(', ')}`);
    if (!rows.length) throw new Error('no files in /utilities/api/store/superprod/');
    const prop = await a.evaluate(async () => {
      const r = await fetch('/utilities/dav/superprod/super-productivity/', { method: 'PROPFIND', headers: { Depth: '1' } });
      return { status: r.status, body: await r.text() };
    });
    if (prop.status !== 207) throw new Error(`PROPFIND ${prop.status}`);
    const hrefs = [...prop.body.matchAll(/<D:href>([^<]*)<\/D:href>/g)].map((m) => m[1]);
    console.log(`PROPFIND (via shim): ${hrefs.join(' ')}`);
    const hasTask = await a.evaluate(async (t) => {
      const list = await (await fetch('/utilities/api/store/superprod/?prefix=super-productivity/')).json();
      for (const it of list) {
        const txt = await (await fetch('/utilities/api/store/superprod/' + it.path.split('/').map(encodeURIComponent).join('/'))).text();
        if (txt.includes(t)) return it.path;
      }
      return null;
    }, TITLE);
    if (!hasTask) throw new Error('task title not found in any synced file');
    console.log(`task found in ${hasTask}`);

    // --- device B: empty profile, sync down --------------------------------
    const ctxB = await browser.createBrowserContext();
    const b = await ctxB.newPage(); await b.setViewport({ width: 1300, height: 900 });
    await login(b);
    watch(b, 'B'); trackHub(b);
    await openApp(b);
    await sleep(3000);
    await hubIdle(b, 5000);
    await sync(b);
    await b.goto(`${APP}#/tag/TODAY/tasks`, { waitUntil: 'load' });
    await b.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 30000 }, TITLE)
      .catch(async (e) => { await b.screenshot({ path: '/tmp/superprod-fail.png' }); throw e; });
    console.log('B: task arrived from the ship');

    // --- 3. A and B both synced; A changes and syncs, then B changes and syncs
    // without pulling first --------------------------------------------------
    const TA1 = `ship conflict a ${tag()}`, TB1 = `ship conflict b ${tag()}`;
    await addTask(a, TA1); await sync(a);
    await addTask(b, TB1); await sync(b);
    await shipHas(b, [TITLE, TA1, TB1]);
    await shows(b, [TITLE, TA1, TB1], 'B');
    await sync(a);
    await shows(a, [TITLE, TA1, TB1], 'A');
    console.log('sequential: B merged A\'s change before uploading; ship and both clients have both tasks');

    // --- 4. forced race: hold B's PUT of sync-data.json (sent with If-Match of
    // the rev B just read) until A has synced a newer version ----------------
    const TA2 = `ship race a ${tag()}`, TB2 = `ship race b ${tag()}`;
    // B's next PUT of sync-data.json is held in the page until A has synced.
    // kit/serve.py answers a 412 without reading the PUT body, which desyncs
    // Chrome's keep-alive connection (the next request on it gets a 400), so
    // the held PUT is sent from node on a connection of its own and the
    // server's real answer is handed back to SP as the fetch result.
    let held = null, release;
    const gate = new Promise((res) => { release = res; });
    await b.exposeFunction('__holdPut', async (req) => {
      held = req;
      await gate;
      const res = await forward(req, (await b.cookies(BASE)).map((c) => `${c.name}=${c.value}`).join('; '));
      if (res.status === 412) race.got412.push(`PUT ${req.url} If-Match ${req.headers['if-match']}`);
      return res;
    });
    await b.evaluate(() => {
      const orig = window.fetch;
      window.fetch = async function (input, init = {}) {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href).href;
        if ((init.method || 'GET') === 'PUT' && /\/sync-data\.json$/.test(url)) {
          window.fetch = orig;
          const headers = Object.fromEntries(new Headers(init.headers).entries());
          const r = await window.__holdPut({ method: 'PUT', url, headers, body: String(init.body) });
          return new Response(r.status === 204 ? null : r.body, { status: r.status, headers: r.headers });
        }
        return orig.apply(this, arguments);
      };
    });
    race = { got412: [], console: [] };
    // SP syncs on its own right after a change; otherwise press sync
    await addTask(b, TB2);
    if (!held) await (await b.waitForSelector('button.sync-btn:not(.is-in-progress)')).evaluate((x) => x.click());
    for (let i = 0; !held; i++) { if (i > 150) throw new Error('B never sent its PUT'); await sleep(200); }
    console.log(`race: holding B's PUT (If-Match ${held.headers['if-match']}) while A syncs`);
    await addTask(a, TA2); await sync(a);
    await shipHas(a, [TA2]);
    release();
    await hubIdle(b, 3000);
    await b.waitForSelector('button.sync-btn:not(.is-in-progress)', { timeout: 30000 });
    console.log(`race: B's stale PUT -> ${race.got412.join('; ') || 'no 412'}`);
    if (!race.got412.length) throw new Error('B\'s stale conditional PUT was not rejected with 412');
    if (race.console.length) console.log(`race: B logged ${race.console.length} expected console error(s): ${race.console.join(' | ')}`);
    await shipHas(b, [TA2]); // the 412 kept A's version
    const errBtn = !!(await b.$('button.sync-btn.is-error'));
    console.log(`race: after the 412, B's sync button ${errBtn ? 'shows an error' : 'shows no error'}`);
    race = null;
    await sync(b); // next cycle: download A's ops, merge, conditional upload
    await shipHas(b, [TITLE, TA1, TB1, TA2, TB2]);
    await shows(b, [TA2, TB2], 'B');
    await sync(a);
    await shows(a, [TA2, TB2], 'A');
    console.log('race: after one more sync the ship and both clients have both tasks');
    await ctxB.close();
    await ctxA.close();
    ok = errs.length === 0;
  } catch (e) {
    console.log('FAIL', e.stack.split('\n').slice(0, 4).join(' | '));
  }
  for (const e of errs) console.log('ERR', e);
  await browser.close();
  console.log(ok ? 'PASS superprod' : 'FAIL superprod');
  process.exit(ok ? 0 : 1);
})();
