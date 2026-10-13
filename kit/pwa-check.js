// Check a satellite is an installable PWA: logs in, loads /<desk>/, waits for
// the service worker, and asks Chrome for installability errors.
// usage: BASE_URL=http://localhost:8200 SHIP_CODE=x CHROME=... node kit/pwa-check.js <desk>
const puppeteer = require('/home/amadeo/Research/vert-urbit/test/node_modules/puppeteer-core');
const DESK = process.argv[2], BASE = process.env.BASE_URL || 'http://localhost:8200';
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(`${BASE}/~/login`);
  await page.type('input[type=password]', process.env.SHIP_CODE || 'x');
  await Promise.all([page.waitForNavigation().catch(() => {}), page.keyboard.press('Enter')]);
  await page.goto(`${BASE}/${DESK}/`, { waitUntil: 'load' });
  // apps may redirect or reload once on first load (e.g. a COOP/COEP worker); let it settle
  await page.waitForNavigation({ waitUntil: 'load', timeout: 8000 }).catch(() => {});
  const sw = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.scope).catch((e) => 'none: ' + e));
  const cdp = await page.createCDPSession();
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  const manifest = await cdp.send('Page.getAppManifest');
  console.log(`${DESK}: sw scope=${sw} manifest=${manifest.url} errors=${JSON.stringify(installabilityErrors.map((e) => e.errorId))}`);
  await browser.close();
  process.exit(installabilityErrors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
