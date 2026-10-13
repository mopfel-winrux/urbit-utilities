// Smoke test for the FossFLOW satellite: log in, open /fossflow/, drag an icon
// from the "Add item" panel onto the canvas, export the diagram through
// "Export File" and check the downloaded JSON contains the placed node.
// usage: BASE_URL=http://localhost:8203 SHIP_CODE=... CHROME=... node test.js
const puppeteer = require('/home/amadeo/Research/vert-urbit/test/node_modules/puppeteer-core');
const fs = require('fs'), os = require('os'), path = require('path');
const BASE = (process.env.BASE_URL || 'http://localhost:8203').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'x';
const CHROME = process.env.CHROME || `${os.homedir()}/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome`;
const DESK = 'fossflow';
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), `${DESK}-test-`)), DL = path.join(OUT, 'dl');
fs.mkdirSync(DL);
let pageRef;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDownload(timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const done = fs.readdirSync(DL).filter((f) => !f.endsWith('.crdownload'));
    if (done.length) return path.join(DL, done[0]);
    await sleep(250);
  }
  throw new Error('download timed out');
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = pageRef = await browser.newPage(); await page.setViewport({ width: 1400, height: 900 });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
  await page.goto(`${BASE}/~/login?redirect=/utilities/icon.svg`);
  await page.type('input[type=password]', CODE);
  await Promise.all([page.waitForNavigation().catch(() => {}), page.keyboard.press('Enter')]);
  const errs = [], origin = new URL(BASE).origin;
  if (process.env.VERBOSE) page.on('console', (m) => console.log(`  [${m.type()}] ${m.text().slice(0, 300)}`));
  page.on('pageerror', (e) => errs.push(`pageerror ${e.message}`));
  page.on('requestfailed', (r) => { if (r.url().startsWith(origin)) errs.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`); });
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(origin)) errs.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('request', (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origin)) errs.push(`external request ${r.url()}`); });

  await page.goto(`${BASE}/${DESK}/`, { waitUntil: 'load' });
  const add = await page.waitForSelector('button[aria-label="Add item (N)"]', { timeout: 30000 });
  await add.click();
  // expand the first icon collection if it is collapsed, then drag its first icon to the canvas
  await page.waitForFunction(() => document.querySelector('img[alt^="Icon "]') ||
    [...document.querySelectorAll('button')].some((b) => b.querySelector('[data-testid=ExpandMoreIcon]')), { timeout: 20000 });
  await page.evaluate(() => {
    if (document.querySelector('img[alt^="Icon "]')) return;
    [...document.querySelectorAll('button')].find((b) => b.querySelector('[data-testid=ExpandMoreIcon]')).click();
  });
  const icon = await page.waitForSelector('img[alt^="Icon "]', { visible: true, timeout: 20000 });
  const iconName = await icon.evaluate((i) => i.alt.replace(/^Icon /, ''));
  const box = await icon.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + (700 - box.x) * i / 10, box.y + (500 - box.y) * i / 10);
  await page.mouse.up();
  await sleep(1000);

  const exp = await page.waitForFunction(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Export File')));
  await exp.asElement().click();
  const dl = await page.waitForFunction(() => [...document.querySelectorAll('button')].find((b) => /^Download/.test(b.textContent.trim())), { timeout: 10000 });
  await dl.asElement().click();
  const file = await waitForDownload(20000);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const d = json.data || json;
  const items = d.items || [];
  const placed = (d.views || []).flatMap((v) => v.items || []);
  console.log(`dragged "${iconName}"; exported ${path.basename(file)}: ${items.length} item(s), ${placed.length} placed in views, icons ${items.map((i) => i.icon).join(',')}`);
  const ok = items.length >= 1 && placed.length >= 1;
  console.log('page errors:', errs.length ? '\n  ' + [...new Set(errs)].join('\n  ') : 'none');
  if (!ok || errs.length) await page.screenshot({ path: path.join(OUT, 'fail.png') });
  await browser.close();
  if (!ok) { console.log('FAIL: exported diagram has no node'); process.exit(1); }
  if (errs.length) { console.log('FAIL: page errors'); process.exit(1); }
  fs.rmSync(OUT, { recursive: true, force: true });
  console.log('PASS');
})().catch(async (e) => {
  console.error('FAILED', e.message);
  if (pageRef) await pageRef.screenshot({ path: path.join(OUT, 'fail.png') }).catch(() => {});
  console.error('screenshot:', path.join(OUT, 'fail.png'));
  process.exit(1);
});
