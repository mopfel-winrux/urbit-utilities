// Smoke test for the miniPaint satellite: log in, open /minipaint/, open a PNG
// through File > Open > Open File, apply Effects > Common Filters > Grayscale,
// export it as PNG through File > Export, and check the downloaded image is
// the same size and grayscale.
// usage: BASE_URL=http://localhost:8203 SHIP_CODE=... CHROME=... node test.js
const puppeteer = require('/home/amadeo/Research/vert-urbit/test/node_modules/puppeteer-core');
const fs = require('fs'), os = require('os'), path = require('path');
const BASE = (process.env.BASE_URL || 'http://localhost:8203').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'x';
const CHROME = process.env.CHROME || `${os.homedir()}/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome`;
const DESK = 'minipaint';
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
  await page.waitForSelector('#main_menu a[role=menuitem]', { timeout: 30000 });

  // a 120x80 test image with colored stripes
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 120; c.height = 80;
    const x = c.getContext('2d');
    ['#e53935', '#43a047', '#1e88e5', '#fdd835'].forEach((col, i) => { x.fillStyle = col; x.fillRect(i * 30, 0, 30, 80); });
    return c.toDataURL('image/png').split(',')[1];
  });
  fs.writeFileSync(path.join(OUT, 'in.png'), Buffer.from(png, 'base64'));

  // click a menu path by visible names
  async function menu(...names) {
    for (const name of names) {
      const el = await page.waitForFunction((name) => [...document.querySelectorAll('#main_menu a[role=menuitem], .menu_dropdown a, a[role=menuitem]')]
        .find((a) => a.offsetParent && (a.querySelector('.name .trn') || a.querySelector('.name'))?.textContent.trim() === name), { timeout: 10000 }, name);
      await el.evaluate((a) => a.click());
      await sleep(300);
    }
  }
  async function popupOk() {
    const ok = await page.waitForSelector('#popups [data-id=popup_ok]', { visible: true, timeout: 10000 });
    await ok.click(); await sleep(500);
  }

  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10000 }), menu('File', 'Open', 'Open File')]);
  await chooser.accept([path.join(OUT, 'in.png')]);
  await page.waitForFunction(() => window.AppConfig && AppConfig.layers.some((l) => l.type === 'image' && l.width === 120), { timeout: 15000 });

  await menu('Effects', 'Common Filters', 'Grayscale');
  await popupOk();

  await menu('File', 'Export');
  await page.waitForSelector('#popups [data-id=popup_ok]', { visible: true });
  await sleep(500);
  if (process.env.VERBOSE) await page.screenshot({ path: path.join(OUT, 'export.png') });
  await popupOk();
  const file = await waitForDownload(20000);

  const data = fs.readFileSync(file).toString('base64');
  const res = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let gray = true;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - d[i + 1]) > 2 || Math.abs(d[i + 1] - d[i + 2]) > 2) { gray = false; break; }
    return { w: img.width, h: img.height, gray, sample: [...d.slice(0, 4)] };
  }, data);
  console.log(`exported ${path.basename(file)}: ${res.w}x${res.h} grayscale=${res.gray} first pixel=${res.sample}`);
  const ok = res.w === 120 && res.h === 80 && res.gray && !(res.sample[0] === 0xe5 && res.sample[1] === 0x39);
  console.log('page errors:', errs.length ? '\n  ' + [...new Set(errs)].join('\n  ') : 'none');
  if (!ok || errs.length) await page.screenshot({ path: path.join(OUT, 'fail.png') });
  await browser.close();
  if (!ok) { console.log('FAIL: exported image is not the grayscale 120x80 image'); process.exit(1); }
  if (errs.length) { console.log('FAIL: page errors'); process.exit(1); }
  fs.rmSync(OUT, { recursive: true, force: true });
  console.log('PASS');
})().catch(async (e) => {
  console.error('FAILED', e.message);
  if (pageRef) await pageRef.screenshot({ path: path.join(OUT, 'fail.png') }).catch(() => {});
  console.error('screenshot:', path.join(OUT, 'fail.png'));
  process.exit(1);
});
