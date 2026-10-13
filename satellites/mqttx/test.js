// Smoke test for /mqttx: log in to the ship, load MQTTX Web, open the New
// Connection form, fill in a name and a broker host, "Save" it, and check that
// the connection is listed and still there after a reload (browser storage).
// env: BASE_URL (default http://localhost:8204), SHIP_CODE, CHROME
const puppeteer = require('/home/amadeo/Research/vert-urbit/test/node_modules/puppeteer-core');
const BASE = process.env.BASE_URL || 'http://localhost:8204';
const DESK = 'mqttx';
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
  // only the ship's own responses count; brokers may be unreachable in the test environment
  page.on('response', (r) => { if (r.url().startsWith(ORIGIN) && r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(ORIGIN) && r.failure()?.errorText !== 'net::ERR_ABORTED') errs.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`);
  });

  await page.goto(`${BASE}/${DESK}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => /New Connection/.test(document.body.innerText), { timeout: 60000 });
  await page.evaluate(() => [...document.querySelectorAll('button, a')].find((e) => /New Connection/.test(e.innerText)).click());
  await page.waitForSelector('.connection-form .el-autocomplete input', { visible: true, timeout: 15000 });
  const name = `urbit-test-${Date.now() % 100000}`;
  await page.type('.connection-form .el-autocomplete input', name);
  const host = (await page.$$('.connection-form .host-item input')).pop(); // [protocol select, host]
  await host.click({ clickCount: 3 });
  await host.type('broker.example.org');
  // the split button's dropdown has "Save" (save without connecting)
  await page.click('.connection-form .dropdown-btn');
  const save = await page.waitForFunction(() => [...document.querySelectorAll('li.el-dropdown-menu__item')]
    .find((li) => li.innerText.trim() === 'Save Only' && li.offsetParent), { timeout: 10000 });
  await sleep(300); // dropdown animation
  await save.click();
  await page.waitForFunction((name) => document.querySelector('.connections-list, .left-list, body').innerText.includes(name) && !document.querySelector('.connection-form'), { timeout: 15000 }, name);
  // persisted: reload and look for it again
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction((name) => document.body.innerText.includes(name) && document.body.innerText.includes('broker.example.org'), { timeout: 30000 }, name);
  console.log(`saved connection ${name} (ws://broker.example.org:8083/mqtt) and found it after reload`);
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
