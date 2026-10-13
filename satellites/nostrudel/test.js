// Smoke test for /nostrudel: log in to the ship, load noStrudel, open the
// private-key sign-in, generate a new key locally ("Generate New"), sign in
// with it, and check that the account is active and its npub is shown.
// env: BASE_URL (default http://localhost:8204), SHIP_CODE, CHROME
const puppeteer = require('/home/amadeo/Research/vert-urbit/test/node_modules/puppeteer-core');
const BASE = process.env.BASE_URL || 'http://localhost:8204';
const DESK = 'nostrudel';
const ORIGIN = new URL(BASE).origin;
let page;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
  page = await browser.newPage(); await page.setViewport({ width: 1300, height: 1000 });
  await page.goto(`${BASE}/~/login?redirect=/utilities/icon.svg`);
  await page.type('input[type=password]', process.env.SHIP_CODE || 'x');
  await Promise.all([page.waitForNavigation().catch(() => {}), page.keyboard.press('Enter')]);

  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror ${e.message}`));
  // only the ship's own responses count; relays, media hosts and NIP-05 lookups may fail offline
  page.on('response', (r) => { if (r.url().startsWith(ORIGIN) && r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(ORIGIN) && r.failure()?.errorText !== 'net::ERR_ABORTED') errs.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`);
  });

  await page.goto(`${BASE}/${DESK}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => /Welcome to noStrudel/.test(document.body.innerText), { timeout: 60000 });
  await page.goto(`${BASE}/${DESK}/signin/nsec`, { waitUntil: 'load' });
  const clickButton = (label) => page.evaluate((label) => {
    const b = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === label);
    if (!b) throw new Error(`no button ${label}`);
    b.click();
  }, label);
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Generate New'), { timeout: 30000 });
  await clickButton('Generate New');
  const nsec = await page.waitForFunction(() => {
    const v = document.querySelector('input[placeholder="hex, nsec or ncryptsec"]')?.value;
    return v && v.startsWith('nsec1') && v;
  }, { timeout: 10000 }).then((h) => h.jsonValue());
  page.on('dialog', (d) => d.accept('')); // no local encryption password
  await clickButton('Signin');
  // signed in: the sign-in view goes away and the active account is persisted
  await page.waitForFunction(() => !location.pathname.includes('/signin'), { timeout: 30000 });
  const pubkey = await page.evaluate(async () => {
    for (let i = 0; i < 50; i++) {
      for (const k of Object.keys(localStorage)) {
        const hit = /account/i.test(k) && localStorage.getItem(k).match(/"pubkey":"([0-9a-f]{64})"/);
        if (hit) return hit[1];
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  });
  if (!pubkey) throw new Error('no account persisted');
  await page.waitForFunction(() => !/Welcome to noStrudel/.test(document.body.innerText), { timeout: 30000 });
  console.log(`signed in with a new key ${nsec.slice(0, 10)}..., account ${pubkey}`);
  await sleep(1000);
  await browser.close();
  if (errs.length) { console.log('errors:\n  ' + [...new Set(errs)].join('\n  ')); process.exit(1); }
  console.log('PASS');
})().catch(async (e) => {
  console.error('FAILED', e.message);
  if (page) {
    console.error('at', page.url());
    console.error((await page.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 600));
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT }).catch(() => {});
  }
  process.exit(1);
});
