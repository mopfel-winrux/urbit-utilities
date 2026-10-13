// Excalidraw satellite test: log in, draw two shapes, save the drawing to the
// ship through the %utilities hub, wipe local data and reload, open it again
// from the ship and check the elements came back; autosave a change; share a
// read-only link and open it in an incognito context (no cookie); simulate a
// concurrent writer and check saves are conditional (If-Match / If-None-Match)
// and resolve the conflict three ways; clean up.
// usage: BASE_URL=http://localhost:8206 SHIP_CODE=... CHROME=... node test.js
const puppeteer = require('/home/amadeo/Research/vert-urbit/test/node_modules/puppeteer-core');

const BASE = (process.env.BASE_URL || 'http://localhost:8206').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'x';
const CHROME = process.env.CHROME || `${process.env.HOME}/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome`;
const ORIGIN = new URL(BASE).origin;
const NAME = `e2e drawing ${Date.now()}`;
const PATH = `drawings/${NAME}.excalidraw`;
const COPY = `drawings/${NAME} (my copy).excalidraw`;
const STORE = `${BASE}/utilities/api/store/excalidraw/`;
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errs = [];
const puts = []; // { url, ifMatch, ifNoneMatch, status } of drawing PUTs from the app
const expected412 = [];
function watch(page, label) {
  page.on('pageerror', (e) => errs.push(`${label} pageerror ${e.message}`));
  page.on('console', (m) => {
    if (process.env.VERBOSE) console.log(`  [${label} ${m.type()}] ${m.text().slice(0, 300)}`);
  });
  page.on('dialog', (d) => d.accept());
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(ORIGIN)) errs.push(`${label} requestfailed ${r.method()} ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(ORIGIN) && !/^(data|blob|about|chrome-extension):/.test(u)) errs.push(`${label} external request ${u}`);
  });
  page.on('response', (r) => {
    const q = r.request();
    if (q.method() === 'PUT' && r.url().includes('/utilities/api/store/excalidraw/drawings/')) {
      const h = q.headers();
      puts.push({ url: decodeURIComponent(r.url()), ifMatch: h['if-match'], ifNoneMatch: h['if-none-match'], status: r.status() });
      // a 412 is the hub refusing a stale save: expected in the conflict steps
      if (r.status() === 412) { expected412.push(r.url()); return; }
    }
    if (r.status() >= 400 && r.url().startsWith(ORIGIN)) errs.push(`${label} HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  });
}
function check(cond, msg) {
  if (!cond) throw new Error(msg);
  console.log(`ok   ${msg}`);
}
// the app persists the scene to localStorage["excalidraw"] (debounced)
const localElements = (page) =>
  page.evaluate(() => {
    try {
      return (JSON.parse(localStorage.getItem('excalidraw') || '[]') || []).filter((e) => !e.isDeleted);
    } catch {
      return [];
    }
  });
const apiJSON = (page, url) =>
  page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    return { status: r.status, body: r.ok ? await r.json() : null };
  }, url);

async function drag(page, x1, y1, x2, y2) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
}
async function openPanel(page) {
  if (await page.$('[data-testid=ship-panel]')) return;
  await page.click('.ship-trigger');
  await page.waitForSelector('[data-testid=ship-panel]', { timeout: 10000 });
}
async function waitStatus(page, re, timeout = 15000) {
  await page.waitForFunction(
    (src) => new RegExp(src).test(document.querySelector('[data-testid=ship-status]')?.textContent || ''),
    { timeout }, re.source);
}
async function loadApp(page) {
  await page.goto(`${BASE}/excalidraw/`, { waitUntil: 'load' });
  await page.waitForSelector('.excalidraw canvas.interactive', { timeout: 60000 });
  await page.waitForSelector('.ship-trigger', { timeout: 30000 });
  await sleep(500);
}

// wipe local data without the app's unload handler saving the scene again
// another writer (another tab or device) saves a 1-element scene directly
const THEIRS = (id) => JSON.stringify({
  type: 'excalidraw', version: 2, source: 'other-writer',
  elements: [{ id, type: 'rectangle', x: 0, y: 0, width: 120, height: 80, angle: 0,
    strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2,
    strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null,
    seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1,
    link: null, locked: false }],
  appState: { viewBackgroundColor: '#ffffff' }, files: {},
});
const otherWriter = (page, path, id) =>
  page.evaluate(async (url, body) => {
    const r = await fetch(url, { method: 'PUT', credentials: 'same-origin',
      headers: { 'content-type': 'application/vnd.excalidraw+json' }, body });
    return r.status;
  }, STORE + enc(path), THEIRS(id));
const storedIds = async (page, path) => {
  const r = await apiJSON(page, STORE + enc(path));
  return r.body ? r.body.elements.filter((e) => !e.isDeleted).map((e) => e.id).sort() : null;
};
const waitLocalCount = (page, n) => page.waitForFunction((n) =>
  JSON.parse(localStorage.getItem('excalidraw') || '[]').filter((e) => !e.isDeleted).length === n, { timeout: 10000 }, n);
const conflictShown = (page) => page.$('[data-testid=ship-conflict]').then((x) => !!x);
async function drawShape(page, key, x, y) {
  await page.mouse.click(x - 30, y - 30); // focus canvas (empty spot)
  await page.keyboard.press('Escape');
  await page.keyboard.press(key);
  await drag(page, x, y, x + 90, y + 70);
  await page.keyboard.press('Escape');
  await openPanel(page); // clicking the canvas closes the (undocked) drawer
}

async function wipeLocal(page) {
  await page.goto(`${BASE}/excalidraw/view/`, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  let failed = false;
  let sharePath = null;
  const page = await browser.newPage();
  try {
    // --- owner: log in exactly like test/e2e.js
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`${BASE}/~/login?redirect=/utilities/icon.svg`);
    await page.type('input[type=password]', CODE);
    await Promise.all([page.waitForNavigation().catch(() => {}), page.keyboard.press('Enter')]);
    watch(page, 'owner');

    // start from a clean canvas and no remembered ship file
    await wipeLocal(page);
    await loadApp(page);
    check((await localElements(page)).length === 0, 'app loaded with an empty canvas');

    // --- draw a rectangle and an ellipse
    await page.keyboard.press('r');
    await drag(page, 400, 300, 600, 420);
    await page.keyboard.press('Escape');
    await page.keyboard.press('o');
    await drag(page, 700, 300, 850, 450);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => {
      const els = JSON.parse(localStorage.getItem('excalidraw') || '[]').filter((e) => !e.isDeleted);
      return els.length === 2;
    }, { timeout: 10000 });
    const drawn = await localElements(page);
    check(drawn.map((e) => e.type).sort().join() === 'ellipse,rectangle', 'drew a rectangle and an ellipse');

    // --- save to the ship (Save with no current file asks for a name)
    await openPanel(page);
    await page.click('[data-testid=ship-save]');
    await page.waitForSelector('[data-testid=ship-name]');
    await page.focus('[data-testid=ship-name]');
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.type('[data-testid=ship-name]', NAME);
    await page.click('[data-testid=ship-saveas-confirm]');
    await waitStatus(page, /^Saved "/);
    const list = await apiJSON(page, `${STORE}?prefix=drawings/`);
    const row = (list.body || []).find((r) => r.path === PATH);
    check(row && !row.public, `store list API has ${PATH} (private)`);
    const first = puts.find((p) => p.url.endsWith(PATH));
    check(first && first.ifNoneMatch === '*' && !first.ifMatch, 'saving a new drawing sends If-None-Match: * (create only)');
    const stored = await apiJSON(page, STORE + enc(PATH));
    check(stored.status === 200 && stored.body.type === 'excalidraw' &&
      stored.body.elements.filter((e) => !e.isDeleted).length === 2, 'stored file is an .excalidraw scene with 2 elements');
    check(await page.$eval('[data-testid=ship-current]', (el, name) => el.textContent.includes(name), NAME), 'panel shows the current ship file');

    // --- wipe local data, reload: canvas empty; open from the ship
    await wipeLocal(page);
    await loadApp(page);
    check((await localElements(page)).length === 0, 'after wiping local data and reloading, canvas is empty');
    await openPanel(page);
    const openBtn = await page.waitForSelector(`li[data-path="${PATH}"] [data-testid=ship-open]`, { timeout: 15000 });
    await openBtn.click();
    await waitStatus(page, /^Opened "/);
    await page.waitForFunction(() =>
      JSON.parse(localStorage.getItem('excalidraw') || '[]').filter((e) => !e.isDeleted).length === 2, { timeout: 10000 });
    const back = await localElements(page);
    check(drawn.map((e) => e.id).sort().join() === back.map((e) => e.id).sort().join(),
      'opened from the ship: the same 2 elements are back');

    // --- autosave: turn it on, draw a third shape, the ship copy follows
    await page.click('[data-testid=ship-autosave]');
    await page.mouse.click(1000, 700); // focus canvas
    await page.keyboard.press('Escape');
    await page.keyboard.press('d'); // diamond
    await drag(page, 400, 550, 550, 680);
    await page.keyboard.press('Escape');
    let autoN = 0;
    for (let i = 0; i < 40 && autoN !== 3; i++) {
      await sleep(500);
      const auto = await apiJSON(page, STORE + enc(PATH));
      autoN = auto.body.elements.filter((e) => !e.isDeleted).length;
    }
    check(autoN === 3, 'autosave wrote the third element to the ship');
    const autoPut = puts.filter((p) => p.url.endsWith(PATH) && p.status < 300).pop();
    check(autoPut && /^"[0-9a-f]+"$/.test(autoPut.ifMatch || '') && !autoPut.ifNoneMatch,
      `autosave sends If-Match with the ETag it opened (${autoPut && autoPut.ifMatch})`);

    // --- share a read-only link
    await openPanel(page);
    await page.click('[data-testid=ship-share]');
    await page.waitForSelector('[data-testid=ship-share-viewer]', { timeout: 15000 });
    const viewer = await page.$eval('[data-testid=ship-share-viewer]', (a) => a.href);
    const pub = await page.$eval('[data-testid=ship-share-pub]', (a) => a.href);
    sharePath = decodeURIComponent(new URL(viewer).hash.slice(1));
    console.log(`     viewer: ${viewer}\n     public: ${pub}`);
    check(viewer.startsWith(`${ORIGIN}/excalidraw/view/#shared/`) && pub.startsWith(`${ORIGIN}/utilities/pub/excalidraw/shared/`),
      'share link points at /excalidraw/view/ and /utilities/pub/excalidraw/shared/');
    const shares = await apiJSON(page, `${STORE}?prefix=shared/`);
    check((shares.body || []).some((r) => r.path === sharePath && r.public), 'shared snapshot is stored with public=true');

    // --- incognito: no cookie, open the viewer
    const anon = await browser.createBrowserContext();
    const ap = await anon.newPage();
    await ap.setViewport({ width: 1200, height: 800 });
    watch(ap, 'anon');
    const cookies = await ap.cookies(BASE);
    check(cookies.length === 0, 'incognito context has no ship cookie');
    await ap.goto(viewer, { waitUntil: 'load' });
    await ap.waitForSelector('[data-testid=viewer] .excalidraw canvas', { timeout: 60000 });
    const n = await ap.$eval('[data-testid=viewer]', (el) => Number(el.dataset.elements));
    check(n === 3, `logged-out viewer renders the shared drawing (${n} elements)`);
    check(await ap.$('.excalidraw.excalidraw--view-mode') !== null, 'viewer is in read-only view mode');
    const raw = await ap.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'omit' });
      return { status: r.status, n: r.ok ? (await r.json()).elements.length : 0 };
    }, pub);
    check(raw.status === 200 && raw.n === 3, 'logged-out GET of the /utilities/pub URL returns the drawing');
    await sleep(1000);
    await anon.close();

    // --- concurrent writer #1, autosave on: autosave must not overwrite
    await page.bringToFront();
    await openPanel(page);
    check(await otherWriter(page, PATH, 'theirs-1') === 200, 'another writer replaced the drawing on the ship');
    const n412 = expected412.length;
    await drawShape(page, 'r', 300, 160);
    await page.waitForSelector('[data-testid=ship-conflict]', { timeout: 15000 });
    check(expected412.length > n412, 'autosave PUT got 412 Precondition Failed');
    await waitStatus(page, /Autosave paused/);
    check(true, 'conflict UI appears and autosave says it is paused');
    await sleep(4500); // longer than the autosave delay: no retry, no overwrite
    await drawShape(page, 'o', 300, 300);
    await sleep(4500);
    check((await storedIds(page, PATH)).join() === 'theirs-1', "ship copy is still the other writer's after two autosave windows");
    check(await page.$eval('[data-testid=ship-autosave]', (c) => c.checked), 'autosave stays enabled (paused, not switched off)');

    // resolution A: save mine as a copy
    await page.click('[data-testid=ship-conflict-copy]');
    await page.waitForSelector('[data-testid=ship-name]');
    check(await page.$eval('[data-testid=ship-name]', (i) => i.value) === `${NAME} (my copy)`, 'Save mine as a copy suggests "<name> (my copy)"');
    await page.click('[data-testid=ship-saveas-confirm]');
    await waitStatus(page, /^Saved ".*\(my copy\)"/);
    await waitLocalCount(page, 5);
    const mine = (await localElements(page)).map((e) => e.id).sort();
    check(mine.length === 5 && (await storedIds(page, COPY)).join() === mine.join(), 'my 5 elements are saved as the copy');
    check((await storedIds(page, PATH)).join() === 'theirs-1', "the original still holds the other writer's version");
    check(!(await conflictShown(page)), 'conflict UI is gone after saving a copy');
    check(await page.$eval('[data-testid=ship-current]', (el) => el.textContent.includes('(my copy)')), 'the copy is now the current ship file');

    // --- concurrent writer #2, manual Save (autosave off): resolution B, overwrite theirs
    await page.click('[data-testid=ship-autosave]');
    check(!(await page.$eval('[data-testid=ship-autosave]', (c) => c.checked)), 'autosave turned off');
    check(await otherWriter(page, COPY, 'theirs-2') === 200, 'another writer replaced the copy');
    await drawShape(page, 'd', 300, 440);
    await page.click('[data-testid=ship-save]');
    await page.waitForSelector('[data-testid=ship-conflict]', { timeout: 15000 });
    const savePut = puts[puts.length - 1];
    check(savePut.status === 412 && savePut.ifMatch && savePut.url.endsWith(COPY), 'manual Save sent If-Match and got 412');
    check((await storedIds(page, COPY)).join() === 'theirs-2', 'manual Save did not overwrite');
    await page.click('[data-testid=ship-conflict-overwrite]');
    await waitStatus(page, /^Saved "/);
    await waitLocalCount(page, 6);
    const mine6 = (await localElements(page)).map((e) => e.id).sort();
    const stored6 = await storedIds(page, COPY);
    check(mine6.length === 6 && stored6.join() === mine6.join(), `Overwrite theirs wrote my 6 elements (local ${mine6.length}, ship ${stored6.length})`);
    check(!(await conflictShown(page)), 'conflict UI is gone after overwriting');

    // --- concurrent writer #3: resolution C, discard mine and load theirs
    check(await otherWriter(page, COPY, 'theirs-3') === 200, 'another writer replaced the copy again');
    await drawShape(page, 'r', 300, 580);
    await page.click('[data-testid=ship-save]');
    await page.waitForSelector('[data-testid=ship-conflict]', { timeout: 15000 });
    check((await storedIds(page, COPY)).join() === 'theirs-3', 'Save did not overwrite (third writer)');
    await page.click('[data-testid=ship-conflict-load]');
    await waitStatus(page, /^Opened "/);
    await page.waitForFunction(() =>
      JSON.parse(localStorage.getItem('excalidraw') || '[]').filter((e) => !e.isDeleted).map((e) => e.id).join() === 'theirs-3', { timeout: 10000 });
    check(true, "Discard mine, load theirs shows the other writer's drawing");
    check(!(await conflictShown(page)), 'conflict UI is gone after loading theirs');
    // and the ETag from that load lets the next save through
    await drawShape(page, 'o', 300, 300);
    await page.click('[data-testid=ship-save]');
    await waitStatus(page, /^Saved "/);
    check((await storedIds(page, COPY)).length === 2 && !(await conflictShown(page)), 'saving after loading theirs succeeds with the new ETag');
    await page.evaluate(async (u) => { const r = await fetch(u, { method: 'DELETE', credentials: 'same-origin' }); await r.arrayBuffer(); }, STORE + enc(COPY));

    // --- revoke the share and delete the drawing through the panel
    await page.click('[data-testid=ship-refresh]');
    const revoke = await page.waitForSelector(`[data-testid=ship-shares] li[data-path="${sharePath}"] button.ship-btn--danger`, { timeout: 10000 });
    await revoke.click();
    await page.waitForFunction((p) => !document.querySelector(`[data-testid=ship-shares] li[data-path="${p}"]`), { timeout: 10000 }, sharePath);
    const del = await page.waitForSelector(`li[data-path="${PATH}"] [data-testid=ship-delete]`);
    await del.click();
    await waitStatus(page, /^Deleted "/);
    const after = await apiJSON(page, `${STORE}?prefix=`);
    check(!(after.body || []).some((r) => r.path === PATH || r.path === sharePath), 'drawing and share deleted from the ship');
    sharePath = null;

    await sleep(500);
    check(errs.length === 0, `no page errors, external requests or failed ship requests${errs.length ? ':\n  ' + errs.join('\n  ') : ''}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${e.message}`);
    if (errs.length) console.log('  errors seen:\n  ' + errs.join('\n  '));
    await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'excalidraw-test-fail.png') }).catch(() => {});
    // best-effort cleanup
    await page.evaluate(async (urls) => { for (const u of urls) await fetch(u, { method: 'DELETE' }); },
      [STORE + enc(PATH), STORE + enc(COPY), ...(sharePath ? [STORE + enc(sharePath)] : [])]).catch(() => {});
  }
  await browser.close();
  console.log(failed ? 'FAILED' : 'PASSED');
  process.exit(failed ? 1 : 0);
})();
