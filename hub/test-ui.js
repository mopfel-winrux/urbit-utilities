// Puppeteer test for the %utilities hub UI.
// usage: BASE_URL=http://localhost:8098 SHIP_CODE=... CHROME=... node hub/test-ui.js
//   BASE_URL      default http://localhost:8098
//   SHIP_CODE     default: contents of ../.ship-code (any value works on the mock)
//   INSTALL_DESK  desk to uninstall and reinstall through the UI (default vert;
//                 "" skips it). Skipped automatically on the mock, which can't
//                 really uninstall anything.
// Logs in, checks the catalog renders (search, category filter, tier badges,
// installed tiles), exercises the storage view (item put via the API, listed,
// made public, public link opened in a cookie-less incognito context, deleted)
// and runs the uninstall/reinstall flow. Fails on any page error, console
// error, failed request or HTTP >= 400 from the hub page.
const puppeteer = require('/home/amadeo/Research/vert-urbit/test/node_modules/puppeteer-core');
const fs = require('fs'), path = require('path');

const BASE = (process.env.BASE_URL || 'http://localhost:8098').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || (() => {
  try { return fs.readFileSync(path.join(__dirname, '..', '.ship-code'), 'utf8').trim(); } catch (e) { return 'x'; }
})();
const CHROME = process.env.CHROME ||
  `${process.env.HOME}/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome`;
const APP = `uitest-${Date.now().toString(36)}`;
const ITEM = 'docs/hello world.txt', BODY = 'hello from the hub test';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok   ${name}`);
  else { failed++; console.log(`  FAIL ${name}${extra ? `  (${extra})` : ''}`); }
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/~/login?redirect=/utilities/`);
  await page.type('input[type=password]', CODE);
  await Promise.all([page.waitForNavigation().catch(() => {}), page.keyboard.press('Enter')]);
  const cookie = (await page.cookies()).filter((c) => c.name.startsWith('urbauth-')).map((c) => `${c.name}=${c.value}`).join('; ');
  check('logged in', !!cookie);
  const api = (p, opts = {}) => fetch(`${BASE}/utilities/api${p}`, { ...opts, headers: { cookie, ...(opts.headers || {}) } });
  const server = (await fetch(`${BASE}/utilities/`, { headers: { cookie } })).headers.get('server') || '';
  const isMock = server.includes('mock');
  const INSTALL_DESK = isMock ? '' : (process.env.INSTALL_DESK ?? 'vert');
  console.log(`== ${BASE} (${isMock ? 'mock' : server}) app=${APP}`);

  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console ${m.text()}`); });
  page.on('requestfailed', (r) => { if (!r.url().startsWith('data:')) errs.push(`requestfailed ${r.method()} ${r.url()} ${r.failure()?.errorText}`); });
  page.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('dialog', (d) => d.accept());

  try {
    // ---------- catalog ----------
    console.log('-- catalog');
    const cat = await (await api('/catalog')).json();
    await page.goto(`${BASE}/utilities/`, { waitUntil: 'load' });
    await page.waitForFunction((n) => document.querySelectorAll('#catalog .card').length === n, { timeout: 15000 }, cat.apps.length);
    check('one card per catalog app', true);
    const cards = await page.$$eval('#catalog .card', (cs) => cs.map((c) => ({
      desk: c.dataset.desk, title: c.querySelector('h3').textContent, info: c.querySelector('.info').textContent,
      badges: [...c.querySelectorAll('.badge')].map((b) => b.textContent),
      buttons: [...c.querySelectorAll('.actions .btn')].map((b) => b.textContent),
    })));
    const bad = cat.apps.filter((a, i) => {
      const c = cards[i];
      return !c || c.desk !== a.desk || c.title !== a.title || c.info !== a.info || !c.badges.includes(a.category) ||
        (a.tier === 2) !== c.badges.includes('saves to your ship') ||
        (a.status === 'installed' ? !(c.buttons.includes('Open') && c.buttons.includes('Uninstall'))
          : a.status === 'available' ? !c.buttons.includes('Install') : false);
    });
    check('cards show title, info, category, tier badge and the right buttons', bad.length === 0, bad.map((a) => a.desk).join(','));
    const installed = cat.apps.filter((a) => a.status === 'installed').map((a) => a.desk);
    const tiles = await page.$$eval('#installed .tile', (ts) => ts.map((t) => [t.dataset.desk, t.getAttribute('href'), t.target]));
    check('installed apps are tiles', JSON.stringify(tiles.map((t) => t[0])) === JSON.stringify(installed), `${tiles.length} vs ${installed.length}`);
    check('tiles open /<desk>/ in a new tab', tiles.every(([d, h, t]) => h === `/${d}/` && t === '_blank'));
    check('publisher shown', (await page.$eval('#publisher', (e) => e.textContent)).includes(cat.publisher));

    await page.type('#search', 'cyber');
    const found = await page.$$eval('#catalog .card', (cs) => cs.map((c) => c.dataset.desk));
    check('search filters', found.length >= 1 && found.every((d) => cat.apps.find((a) => a.desk === d).title.toLowerCase().includes('cyber')), found.join(','));
    await page.$eval('#search', (e) => { e.value = ''; e.dispatchEvent(new Event('input')); });
    const someCat = cat.apps[cat.apps.length - 1].category;
    await page.evaluate((c) => [...document.querySelectorAll('#cats .chip')].find((b) => b.textContent === c).click(), someCat);
    const inCat = await page.$$eval('#catalog .card', (cs) => cs.map((c) => c.dataset.desk));
    check(`category filter (${someCat})`, inCat.length === cat.apps.filter((a) => a.category === someCat).length);
    await page.evaluate(() => [...document.querySelectorAll('#cats .chip')].find((b) => b.textContent === 'all').click());

    // ---------- storage ----------
    console.log('-- storage');
    const put = await api(`/store/${APP}/${ITEM.split('/').map(encodeURIComponent).join('/')}`,
      { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: BODY });
    check('PUT item via API', put.status === 200);
    await page.goto(`${BASE}/utilities/#/storage`, { waitUntil: 'load' });
    await page.waitForSelector(`.store-app[data-app="${APP}"]`, { timeout: 10000 });
    await page.click(`.store-app[data-app="${APP}"]`);
    const row = `tr[data-path="${ITEM}"]`;
    await page.waitForSelector(row, { timeout: 10000 });
    const cells = await page.$eval(row, (r) => r.innerText);
    check('item listed with size', cells.includes(ITEM) && cells.includes(`${BODY.length} B`), cells.replace(/\s+/g, ' '));
    check('item starts private', !(await page.$eval(`${row} input[type=checkbox]`, (i) => i.checked)));

    await page.click(`${row} input[type=checkbox]`);
    await page.waitForSelector(`${row} .copy`, { timeout: 10000 });
    const listed = await (await api(`/store/${APP}/`)).json();
    check('toggle made it public', listed[0] && listed[0].public === true);
    const link = `${BASE}/utilities/pub/${APP}/${ITEM.split('/').map(encodeURIComponent).join('/')}`;
    await page.click(`${row} .copy`);
    await page.waitForFunction(() => /copied/i.test(document.querySelector('#toasts').textContent), { timeout: 5000 });
    check('copy link gives feedback', true);

    const incognito = await browser.createBrowserContext();
    const anon = await incognito.newPage();
    check('incognito has no cookie', (await anon.cookies(BASE)).length === 0);
    const r = await anon.goto(link);
    check('public link works without login', r.status() === 200 && (await r.text()) === BODY, `${r.status()}`);
    check('public link is no-store', (r.headers()['cache-control'] || '') === 'no-store');

    await page.click(`${row} input[type=checkbox]`);
    await page.waitForFunction((sel) => !document.querySelector(`${sel} .copy`), { timeout: 10000 }, row);
    const r2 = await anon.goto(link);
    check('private again: public link is 404', r2.status() === 404, `${r2.status()}`);
    await incognito.close();

    await page.click(`${row} .del`);
    await page.waitForSelector('#confirm[open]');
    await page.click('#confirm-ok');
    await page.waitForFunction((sel) => !document.querySelector(sel), { timeout: 10000 }, row);
    check('delete removes the row', true);
    check('deleted on the ship', (await api(`/store/${APP}/${ITEM.split('/').map(encodeURIComponent).join('/')}`)).status === 404);
    check('app gone from storage list', !(await page.$(`.store-app[data-app="${APP}"]`)));

    // ---------- install flow ----------
    if (INSTALL_DESK) {
      console.log(`-- uninstall and reinstall %${INSTALL_DESK}`);
      await page.goto(`${BASE}/utilities/#/apps`, { waitUntil: 'load' });
      const card = `#catalog .card[data-desk="${INSTALL_DESK}"]`;
      await page.waitForSelector(card);
      let st = await page.$eval(card, (c) => c.dataset.status);
      if (st !== 'installed') {
        console.log(`  (it is ${st}; installing it first)`);
        await page.evaluate((c) => [...document.querySelectorAll(`${c} .btn`)].find((b) => /install/i.test(b.textContent)).click(), card);
        await page.waitForSelector(`${card}[data-status="installed"]`, { timeout: 180000 });
      }
      await page.evaluate((c) => [...document.querySelectorAll(`${c} .btn`)].find((b) => b.textContent === 'Uninstall').click(), card);
      await page.waitForSelector('#confirm[open]');
      await page.click('#confirm-ok');
      await page.waitForSelector(`${card}[data-status="suspended"], ${card}[data-status="available"]`, { timeout: 120000 });
      check('uninstall: card flips to not installed', true);
      check('uninstall: tile removed', !(await page.$(`#installed .tile[data-desk="${INSTALL_DESK}"]`)));
      st = (await (await api('/catalog')).json()).apps.find((a) => a.desk === INSTALL_DESK).status;
      check('uninstall: API status', st === 'suspended' || st === 'available', st);
      const t0 = Date.now();
      await page.evaluate((c) => [...document.querySelectorAll(`${c} .btn`)].find((b) => /install/i.test(b.textContent)).click(), card);
      await page.waitForSelector(`${card}[data-status="installing"], ${card}[data-status="installed"]`, { timeout: 10000 });
      check('install: shows progress while installing', true);
      await page.waitForSelector(`${card}[data-status="installed"]`, { timeout: 180000 });
      check(`install: status flips to installed (${((Date.now() - t0) / 1000).toFixed(1)}s)`, true);
      await page.waitForSelector(`#installed .tile[data-desk="${INSTALL_DESK}"]`, { timeout: 5000 });
      check('install: tile is back', true);
      const gall = await fetch(`${BASE}/${INSTALL_DESK}/`, { headers: { cookie } }).catch(() => null);
      check(`install: /${INSTALL_DESK}/ is bound again (not 503)`, gall && gall.status !== 503, gall && gall.status);
    }
  } catch (e) {
    failed++;
    console.log(`  FAIL ${e.stack || e}`);
    await page.screenshot({ path: path.join(require('os').tmpdir(), 'hub-test-ui-fail.png') }).catch(() => {});
  }

  check('no page errors or failed requests', errs.length === 0, errs.slice(0, 5).join(' | '));
  await browser.close();
  console.log(`== ${failed ? `${failed} failed` : 'all passed'}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
