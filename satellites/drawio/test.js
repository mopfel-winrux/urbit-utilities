// Smoke test for the draw.io satellite: log in, open /drawio/, insert a rectangle
// through the toolbar's Insert menu, label it, export the diagram through File > Export as > SVG
// (saved to this device) and check the downloaded SVG contains the shape and
// the embedded diagram XML.
// usage: BASE_URL=http://localhost:8203 SHIP_CODE=... CHROME=... node test.js
const puppeteer = require('/home/amadeo/Research/vert-urbit/test/node_modules/puppeteer-core');
const fs = require('fs'), os = require('os'), path = require('path');
const BASE = (process.env.BASE_URL || 'http://localhost:8203').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'x';
const CHROME = process.env.CHROME || `${os.homedir()}/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome`;
const DESK = 'drawio', LABEL = 'Hello Urbit';
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
  page.on('request', (r) => { if (/^(https?|wss?):/.test(r.url()) && !r.url().startsWith(origin)) errs.push(`external request ${r.url()}`); });

  await page.goto(`${BASE}/${DESK}/`, { waitUntil: 'load' });
  const shot = (n) => process.env.VERBOSE && page.screenshot({ path: path.join(OUT, `${n}.png`) });
  const click = async (el) => { const b = await el.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(400); };
  const byText = (sel, text, timeout = 15000) => page.waitForFunction((sel, text) => [...document.querySelectorAll(sel)]
    .find((e) => e.offsetParent && e.textContent.trim().replace(/\s+/g, ' ').startsWith(text)), { timeout }, sel, text).then((h) => h.asElement());

  // toolbar Insert (+) > Rectangle inserts a rectangle and selects it
  const insert = await page.waitForSelector('.geToolbar a[title^="Insert"]', { visible: true, timeout: 60000 });
  await click(insert);
  await click(await byText('.mxPopupMenu tr.mxPopupMenuItem', 'Rectangle'));
  await page.waitForFunction(() => document.querySelectorAll('.geDiagramContainer svg g g g').length > 0, { timeout: 10000 });
  // type a label into the selected shape
  // edit the label of the selected shape (F2) with the diagram focused
  await page.evaluate(() => document.querySelector('.geDiagramContainer').focus());
  await page.keyboard.press('F2');
  await page.waitForSelector('.mxCellEditor', { visible: true, timeout: 5000 });
  await page.keyboard.type(LABEL);
  await page.keyboard.press('Escape');  // stops editing and applies the label
  await page.waitForFunction((l) => document.querySelector('.geDiagramContainer svg').textContent.includes(l), { timeout: 5000 }, LABEL);
  await shot('1-shape');

  await click(await byText('.geMenubar a.geItem', 'File'));
  await click(await byText('.mxPopupMenu tr.mxPopupMenuItem', 'Export as'));
  await click(await byText('.mxPopupMenu tr.mxPopupMenuItem', 'SVG'));
  await shot('2-dialog');
  await click(await byText('.geDialog button', 'Export'));
  await sleep(500); await shot('3-after-export');
  // device save dialog (file name and location), when shown
  const save = await byText('.geDialog button', 'Save', 3000).catch(() => null);
  if (save) await click(save);
  const file = await waitForDownload(20000);
  const svg = fs.readFileSync(file, 'utf8');
  const hasLabel = svg.includes(LABEL);
  const hasModel = /content="[^"]*mxfile/.test(svg) || svg.includes('&lt;mxfile');
  const hasShape = svg.includes('vertex=&quot;1&quot;') && /data-cell-id="[^"]+-1"/.test(svg);
  console.log(`exported ${path.basename(file)} (${svg.length} bytes): label=${hasLabel} rect=${hasShape} embedded diagram=${hasModel}`);
  const ok = svg.startsWith('<') && svg.includes('<svg') && hasLabel && hasShape && hasModel;
  console.log('page errors:', errs.length ? '\n  ' + [...new Set(errs)].join('\n  ') : 'none');
  if (!ok || errs.length) await page.screenshot({ path: path.join(OUT, 'fail.png') });
  await browser.close();
  if (!ok) { console.log('FAIL: exported SVG is missing the shape'); process.exit(1); }
  if (errs.length) { console.log('FAIL: page errors'); process.exit(1); }
  fs.rmSync(OUT, { recursive: true, force: true });
  console.log('PASS');
})().catch(async (e) => {
  console.error('FAILED', e.message);
  if (pageRef) await pageRef.screenshot({ path: path.join(OUT, 'fail.png') }).catch(() => {});
  console.error('screenshot:', path.join(OUT, 'fail.png'));
  process.exit(1);
});
