// Smoke test for /snort: log in to the ship, load Snort, sign up with a new
// name (Snort generates a fresh Nostr key pair locally), and check that the
// new account is logged in and its npub and private key section are shown on the keys settings page.
// env: BASE_URL (default http://localhost:8204), SHIP_CODE, CHROME
const puppeteer = require('/home/amadeo/Research/vert-urbit/test/node_modules/puppeteer-core');
const BASE = process.env.BASE_URL || 'http://localhost:8204';
const DESK = 'snort';
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
  // the main layout renders a "Sign up" button for logged-out users
  await page.waitForFunction(() => /Sign up/i.test(document.body.innerText), { timeout: 60000 });
  await page.goto(`${BASE}/${DESK}/login/sign-up`, { waitUntil: 'load' });
  const name = `urbit-test-${Date.now() % 100000}`;
  await page.waitForSelector('input.new-username', { timeout: 30000 });
  await page.type('input.new-username', name);
  await page.click('form button.primary');
  await page.waitForFunction(() => location.pathname.endsWith('/login/sign-up/profile'), { timeout: 15000 });
  await page.waitForFunction(() => /Profile Image/.test(document.body.innerText), { timeout: 15000 });
  await sleep(1000); // keys are generated in an effect
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Next').click());
  await page.waitForFunction(() => location.pathname.endsWith('/login/sign-up/topics'), { timeout: 30000 });

  // the generated key pair is now the active login; it is persisted to localStorage after a debounce
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => /"publicKey":"[0-9a-f]{64}"/.test(localStorage.getItem(k))), { timeout: 15000 });
  await page.goto(`${BASE}/${DESK}/settings/keys`, { waitUntil: 'load' });
  const npub = await page.waitForFunction(() => /Private Key/.test(document.body.innerText) && (document.body.innerText.match(/npub1[02-9ac-hj-np-z.]+/) || [])[0], { timeout: 30000 })
    .then((h) => h.jsonValue());
  console.log(`signed up as ${name}: ${npub}`);
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
