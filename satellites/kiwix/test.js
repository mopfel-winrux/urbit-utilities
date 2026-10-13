// Kiwix satellite smoke test: log in, upload the sample ZIM to the ship's store
// through the app, reload, open it from the ship, render articles and check their text.
// usage: BASE_URL=http://localhost:8207 SHIP_CODE=... CHROME=... node test.js
const puppeteer = require('/home/amadeo/Research/vert-urbit/test/node_modules/puppeteer-core');
const path = require('path');
const BASE = (process.env.BASE_URL || 'http://localhost:8207').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'x';
const CHROME = process.env.CHROME || `${process.env.HOME}/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome`;
// ZIM=<path> tests another archive with the same three pages (e.g. a big one, to see lazy reads)
const SAMPLE = process.env.ZIM || path.join(__dirname, 'samples', 'urbit-sample.zim');
const NAME = path.basename(SAMPLE);
const T = 120000;
const origin = new URL(BASE).origin;
// in ServiceWorker mode articles load from /kiwix/<zim>/C/<path>; Restricted mode injects them into www/article.html
const ARTICLE_URL = process.env.RESTRICTED ? /./ : new RegExp(NAME.replace(/\./g, '\\.') + '/');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frameText = async (page, re, urlRe = /./) => {
  const end = Date.now() + T;
  while (Date.now() < end) {
    for (const f of page.frames().filter((f) => f !== page.mainFrame() && urlRe.test(f.url()))) {
      const t = await f.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
      if (re.test(t)) return t;
    }
    await sleep(300);
  }
  const seen = await Promise.all(page.frames().map(async (f) => `${f.url()} => ${JSON.stringify((await f.evaluate(() => document.body ? document.body.innerText : '').catch(() => '')).slice(0, 100))}`));
  throw new Error(`no frame showed ${re}; frames:\n    ${seen.join('\n    ')}`);
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const step = (m) => console.log(`- ${m}`);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });
    await page.goto(`${BASE}/~/login?redirect=/utilities/icon.svg`);
    await page.type('input[type=password]', CODE);
    await Promise.all([page.waitForNavigation().catch(() => {}), page.keyboard.press('Enter')]);
    page.on('pageerror', (e) => errs.push(`pageerror ${e.message}`));
    page.on('console', (m) => { if (process.env.VERBOSE) console.log(`  [${m.type()}] ${m.text().slice(0, 300)}`); });
    page.on('requestfailed', (r) => {
      if (r.url().startsWith(origin) && !/ERR_ABORTED/.test(r.failure()?.errorText || '')) errs.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`);
    });
    page.on('request', (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origin)) errs.push(`external request ${r.url()}`); });
    page.on('response', (r) => { if (r.url().startsWith(origin) && r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });

    // clean slate in the ship store
    await page.goto(`${BASE}/kiwix/`, { waitUntil: 'load' });
    await page.waitForSelector('#shipStore', { timeout: T });
    await page.evaluate((n) => fetch(`/utilities/api/store/kiwix/${n}`, { method: 'DELETE' }), NAME);

    step('upload the sample ZIM to the ship via "Upload ZIM to ship"');
    await page.evaluate(() => window.kiwixShip.refresh());
    const input = await page.waitForSelector('#shipUploadInput');
    await input.uploadFile(SAMPLE);
    await page.waitForFunction((n) => document.querySelector(`#shipZimList li[data-path="${n}"]`), { timeout: T }, NAME);
    const listed = await page.evaluate(() => fetch('/utilities/api/store/kiwix/').then((r) => r.json()));
    const row = listed.find((r) => r.path === NAME);
    if (!row || row.size !== require('fs').statSync(SAMPLE).size) throw new Error(`store listing wrong: ${JSON.stringify(listed)}`);
    step(`store has ${NAME} (${row.size} bytes)`);

    step('reload and open the ZIM from the ship');
    await page.goto(`${BASE}/kiwix/`, { waitUntil: 'load' });
    // wait until the ServiceWorker controls the page so articles are served from the archive
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, { timeout: T }).catch(() => step('(no ServiceWorker controller; Restricted mode)'));
    const open = await page.waitForSelector(`#shipZimList li[data-path="${NAME}"] .ship-open`, { timeout: T });
    // the archive must be read in slices (Range -> 206), never downloaded whole
    const zimReads = [];
    page.on('response', (r) => {
      if (r.request().method() === 'GET' && r.url().endsWith(`/utilities/api/store/kiwix/${encodeURIComponent(NAME)}`)) {
        zimReads.push([r.status(), r.request().headers().range || '']);
      }
    });
    await open.click();
    // kiwix-js asks whether the archive's source is trusted (ServiceWorker mode). Trust it, or with
    // RESTRICTED=1 use Restricted (jQuery) mode, which is what browsers without ServiceWorkers get (plain-HTTP ships)
    const choice = process.env.RESTRICTED ? 'Open in Restricted Mode' : 'Trust Source';
    const trust = await page.waitForFunction((c) => [...document.querySelectorAll('.modal.show button, #alertModal button')]
      .find((b) => b.textContent.trim() === c && b.offsetParent), { timeout: 15000 }, choice).catch(() => null);
    if (trust) { step(`security prompt: ${choice}`); await trust.asElement().click(); }

    step('main page renders');
    await frameText(page, /This tiny archive tests the Kiwix satellite/, ARTICLE_URL);
    step('follow the "Moon" link inside the article');
    const mainFrame = (await Promise.all(page.frames().filter((f) => f !== page.mainFrame()).map(async (f) =>
      [f, await f.evaluate(() => document.body ? document.body.innerText : '').catch(() => '')])))
      .find(([, t]) => /This tiny archive/.test(t))[0];
    await mainFrame.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Moon').click());
    const text = await frameText(page, /quick brown fox reads offline archives/, process.env.RESTRICTED ? /./ : new RegExp(NAME.replace(/\./g, '\\.') + '/.*Moon'));
    step(`article frame: ${page.frames().map((f) => f.url()).find((u) => /Moon/.test(u))}`);
    step(`article text: ${JSON.stringify(text.trim().slice(0, 80))}`);
    await sleep(1500);
    step(`archive reads: ${zimReads.length} (${zimReads.map(([st, rg]) => `${st} ${rg}`).slice(0, 4).join(', ')}${zimReads.length > 4 ? ', ...' : ''})`);
    if (!zimReads.length || zimReads.some(([st, rg]) => st !== 206 || !rg.startsWith('bytes='))) {
      errs.push(`archive was not read with Range requests: ${JSON.stringify(zimReads)}`);
    }
    const size = require('fs').statSync(SAMPLE).size;
    const read = zimReads.reduce((n, [, rg]) => { const [a, b] = rg.slice(6).split('-').map(Number); return n + b - a + 1; }, 0);
    step(`read ${read} of ${size} bytes`);
    if (size > 4e6 && read > size / 2) errs.push(`read ${read} of ${size} bytes: not lazy`);
    if (errs.length) throw new Error('errors:\n  ' + errs.join('\n  '));
    console.log('PASS kiwix');
    await browser.close();
  } catch (e) {
    console.log('FAIL kiwix:', e.message);
    if (errs.length) console.log('  ' + errs.join('\n  '));
    await browser.close();
    process.exit(1);
  }
})();
