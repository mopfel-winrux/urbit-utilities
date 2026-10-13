// Smoke test for the mazanoke satellite: log in, open /mazanoke/, convert a
// PNG to WebP through the real UI and check the result is a smaller WebP.
// usage: BASE_URL=http://localhost:8201 SHIP_CODE=... CHROME=... node test.js
const path = require('path'), fs = require('fs');
const puppeteer = require(process.env.PUPPETEER || path.join(__dirname, '../../test/node_modules/puppeteer-core'));
const BASE = (process.env.BASE_URL || 'http://localhost:8201').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'test';
const SAMPLE = path.join(__dirname, 'samples', 'sample.png');

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
  let ok = false;
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1300, height: 1000 });
    await page.goto(`${BASE}/~/login?redirect=/utilities/icon.svg`);
    await page.type('input[type=password]', CODE);
    await Promise.all([page.waitForNavigation().catch(() => {}), page.keyboard.press('Enter')]);
    const origin = new URL(BASE).origin, errs = [];
    page.on('pageerror', (e) => errs.push(`pageerror ${e.message}`));
    page.on('requestfailed', (r) => { if (r.url().startsWith(origin)) errs.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`); });
    page.on('response', (r) => { if (r.url().startsWith(origin) && r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
    page.on('request', (r) => { const u = r.url(); if (/^https?:/.test(u) && !u.startsWith(origin)) errs.push(`external request ${u}`); });

    await page.goto(`${BASE}/mazanoke/`, { waitUntil: 'networkidle0' });
    // pick "WebP" as the output format
    await page.evaluate(() => document.querySelector('input[name=formatSelect][value="image/webp"]').closest('label, .button-card-radio').click());
    await page.waitForFunction(() => document.querySelector('input[name=formatSelect][value="image/webp"]').checked, { timeout: 5000 });
    const input = await page.$('#compress');
    await input.uploadFile(SAMPLE);
    await page.waitForSelector('.image-output__item-download-button', { timeout: 60000 });
    const out = await page.evaluate(async () => {
      const a = document.querySelector('.image-output__item-download-button');
      const buf = new Uint8Array(await (await fetch(a.href)).arrayBuffer());
      return { name: a.download, size: buf.length, magic: String.fromCharCode(...buf.slice(0, 4), ...buf.slice(8, 12)) };
    });
    const inSize = fs.statSync(SAMPLE).size;
    console.log(`output ${out.name}: ${out.size} bytes (input ${inSize}), magic ${out.magic}`);
    if (out.magic !== 'RIFFWEBP') throw new Error('output is not a WebP');
    if (!out.name.endsWith('.webp')) throw new Error(`unexpected file name ${out.name}`);
    if (!(out.size > 1000 && out.size < inSize)) throw new Error('output size is not smaller than the input');
    if (errs.length) throw new Error('page errors:\n  ' + [...new Set(errs)].join('\n  '));
    ok = true;
    console.log('PASS mazanoke: png -> webp');
  } catch (e) {
    console.error('FAIL mazanoke:', e.message);
  } finally {
    await browser.close();
    process.exit(ok ? 0 : 1);
  }
})();
