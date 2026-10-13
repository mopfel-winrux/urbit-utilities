// Smoke test for the omni-tools satellite: log in, open /omni-tools/, go to the
// "Flip video" tool through the UI, flip samples/sample.mp4 with the vendored
// ffmpeg.wasm core, download the result and check it is a new, valid MP4.
// usage: BASE_URL=http://localhost:8201 SHIP_CODE=... CHROME=... node test.js
const path = require('path'), fs = require('fs'), os = require('os');
const puppeteer = require(process.env.PUPPETEER || path.join(__dirname, '../../test/node_modules/puppeteer-core'));
const BASE = (process.env.BASE_URL || 'http://localhost:8201').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'test';
const SAMPLE = path.join(__dirname, 'samples', 'sample.mp4');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-tools-test-'));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
  let ok = false;
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1300, height: 1000 });
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });
    await page.goto(`${BASE}/~/login?redirect=/utilities/icon.svg`);
    await page.type('input[type=password]', CODE);
    await Promise.all([page.waitForNavigation().catch(() => {}), page.keyboard.press('Enter')]);
    const origin = new URL(BASE).origin, errs = [];
    page.on('pageerror', (e) => errs.push(`pageerror ${e.message}`));
    page.on('requestfailed', (r) => { if (r.url().startsWith(origin)) errs.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`); });
    page.on('response', (r) => { if (r.url().startsWith(origin) && r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
    page.on('request', (r) => { const u = r.url(); if (/^https?:/.test(u) && !u.startsWith(origin)) errs.push(`external request ${u}`); });

    // home -> Video category -> Flip video (client-side routing under /omni-tools/)
    await page.goto(`${BASE}/omni-tools/`, { waitUntil: 'networkidle0' });
    await (await page.waitForSelector('a[href="/omni-tools/categories/video"]')).click();
    await (await page.waitForSelector('a[href="/omni-tools/video/flip"]', { timeout: 15000 })).click();
    await page.waitForFunction(() => location.pathname === '/omni-tools/video/flip');
    // a deep link (reload) must work too: the fileserver serves index.html (spa)
    await page.reload({ waitUntil: 'networkidle0' });

    const input = await page.waitForSelector('input[type=file]');
    await input.uploadFile(SAMPLE);
    // the tool runs on its own once a file is chosen; wait for the download button
    const dl = await page.waitForFunction(() => [...document.querySelectorAll('button')]
      .find((b) => /download/i.test(b.textContent) && !b.disabled), { timeout: 240000 });
    await sleep(500);
    await dl.asElement().click();
    let file;
    const end = Date.now() + 30000;
    while (!file && Date.now() < end) {
      file = fs.readdirSync(OUT).find((f) => !f.endsWith('.crdownload'));
      if (!file) await sleep(250);
    }
    if (!file) throw new Error('result was never downloaded');
    await sleep(500);
    const buf = fs.readFileSync(path.join(OUT, file)), src = fs.readFileSync(SAMPLE);
    console.log(`downloaded ${file}: ${buf.length} bytes (input ${src.length})`);
    if (buf.subarray(4, 8).toString() !== 'ftyp') throw new Error('result is not an MP4');
    if (buf.length < 10000 || buf.equals(src)) throw new Error('result is empty or unchanged');
    if (errs.length) throw new Error('page errors:\n  ' + [...new Set(errs)].join('\n  '));
    ok = true;
    console.log('PASS omni-tools: flip video with ffmpeg.wasm');
  } catch (e) {
    console.error('FAIL omni-tools:', e.message);
  } finally {
    await browser.close();
    fs.rmSync(OUT, { recursive: true, force: true });
    process.exit(ok ? 0 : 1);
  }
})();
