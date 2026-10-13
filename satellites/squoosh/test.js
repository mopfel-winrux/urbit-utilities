// Smoke test for the Squoosh satellite: log in, open /squoosh/, load a PNG,
// encode it with WebP and with MozJPEG in the two editor panes, and check both
// outputs (read from the app's download links) are valid images
// that are smaller than the input.
// usage: BASE_URL=http://localhost:8203 SHIP_CODE=... CHROME=... node test.js
const puppeteer = require('/home/amadeo/Research/vert-urbit/test/node_modules/puppeteer-core');
const fs = require('fs'), os = require('os'), path = require('path');
const BASE = (process.env.BASE_URL || 'http://localhost:8203').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'x';
const CHROME = process.env.CHROME || `${os.homedir()}/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome`;
const DESK = 'squoosh';
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), `${DESK}-test-`));
let pageRef;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = pageRef = await browser.newPage(); await page.setViewport({ width: 1400, height: 900 });
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
  const input = await page.waitForSelector('input[type=file]', { timeout: 30000 });

  // a 640x480 photo-like PNG (gradients plus noise), so lossy codecs have something to win
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const x = c.getContext('2d'), d = x.createImageData(640, 480);
    for (let y = 0; y < 480; y++) for (let i = 0; i < 640; i++) {
      const o = (y * 640 + i) * 4, n = Math.random() * 30;
      d.data[o] = (i / 640) * 220 + n; d.data[o + 1] = (y / 480) * 220 + n; d.data[o + 2] = 128 + Math.sin(i / 20) * 60 + n; d.data[o + 3] = 255;
    }
    x.putImageData(d, 0, 0);
    return c.toDataURL('image/png').split(',')[1];
  });
  const inFile = path.join(OUT, 'in.png');
  fs.writeFileSync(inFile, Buffer.from(png, 'base64'));
  const inSize = fs.statSync(inFile).size;
  await input.uploadFile(inFile);
  await page.waitForFunction((d) => location.pathname === `/${d}/editor`, { timeout: 30000 }, DESK);

  // the editor has one encoder <select> per side
  await page.waitForFunction(() => document.querySelectorAll('select').length >= 2 &&
    [...document.querySelectorAll('select')].some((s) => [...s.options].some((o) => o.value === 'webP')), { timeout: 30000 });
  const results = {};
  for (const [side, codec] of [[0, 'webP'], [1, 'mozJPEG']]) {
    await page.evaluate((side, codec) => {
      const sel = [...document.querySelectorAll('select')].filter((s) => [...s.options].some((o) => o.value === 'webP'))[side];
      sel.value = codec; sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, side, codec);
    await sleep(500);
    // wait for this side's download link to point at an encoded blob of the right type
    const mime = codec === 'webP' ? 'image/webp' : 'image/jpeg';
    const info = await page.waitForFunction(async (side, mime) => {
      const links = [...document.querySelectorAll('a[download]')].filter((a) => a.href.startsWith('blob:'));
      // links are in DOM order: left pane, right pane
      const a = links.length === 2 ? links[side] : links.find((l) => l.download.endsWith(mime === 'image/webp' ? '.webp' : '.jpg'));
      if (!a) return false;
      const blob = await (await fetch(a.href)).blob();
      if (blob.type !== mime) return false;
      const bmp = await createImageBitmap(blob);
      return { name: a.download, size: blob.size, type: blob.type, w: bmp.width, h: bmp.height };
    }, { timeout: 120000, polling: 1000 }, side, mime);
    results[codec] = await info.jsonValue();
  }
  for (const [codec, r] of Object.entries(results))
    console.log(`${codec}: ${r.name} ${r.type} ${r.w}x${r.h} ${r.size} bytes (input PNG ${inSize} bytes, ${(100 * r.size / inSize).toFixed(1)}%)`);
  const ok = Object.values(results).every((r) => r.size > 0 && r.size < inSize && r.w === 640 && r.h === 480);
  console.log('page errors:', errs.length ? '\n  ' + [...new Set(errs)].join('\n  ') : 'none');
  if (!ok || errs.length) await page.screenshot({ path: path.join(OUT, 'fail.png') });
  await browser.close();
  if (!ok) { console.log('FAIL: encoded output is not a smaller 640x480 image'); process.exit(1); }
  if (errs.length) { console.log('FAIL: page errors'); process.exit(1); }
  fs.rmSync(OUT, { recursive: true, force: true });
  console.log('PASS');
})().catch(async (e) => {
  console.error('FAILED', e.message);
  if (pageRef) await pageRef.screenshot({ path: path.join(OUT, 'fail.png') }).catch(() => {});
  console.error('screenshot:', path.join(OUT, 'fail.png'));
  process.exit(1);
});
