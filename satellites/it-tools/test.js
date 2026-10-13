// Smoke test for the it-tools satellite: log in, load the home page, then open
// the deep link /it-tools/hash-text, hash a string and check the SHA-256.
// env: BASE_URL (default http://localhost:8202), SHIP_CODE, CHROME
const path = require('path');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(__dirname, '../../test/node_modules'), __dirname] }));
const BASE = (process.env.BASE_URL || 'http://localhost:8202').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'any';
const DESK = 'it-tools';

(async () => {
  const origin = new URL(BASE).origin;
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1400, height: 1000 });
  await page.goto(`${BASE}/~/login?redirect=/utilities/icon.svg`);
  await page.type('input[type=password]', CODE);
  await Promise.all([page.waitForNavigation().catch(() => {}), page.keyboard.press('Enter')]);
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror ${e.message}`));
  page.on('requestfailed', (r) => { if (!r.url().startsWith('data:')) errs.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`); });
  page.on('request', (r) => { const u = r.url(); if (/^https?:/.test(u) && new URL(u).origin !== origin) errs.push(`external request ${u}`); });
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(origin)) errs.push(`HTTP ${r.status()} ${r.url()}`); });

  let ok = false;
  try {
    await page.goto(`${BASE}/${DESK}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => /Hash text/.test(document.body.innerText), { timeout: 30000 });
    console.log('ok   home page lists the tools');
    // deep link (history routing, served via spa fallback)
    await page.goto(`${BASE}/${DESK}/hash-text`, { waitUntil: 'load' });
    const ta = await page.waitForSelector('textarea', { timeout: 30000 });
    const text = 'hello from urbit';
    await ta.type(text);
    const want = require('crypto').createHash('sha256').update(text).digest('hex');
    await page.waitForFunction((w) => [...document.querySelectorAll('input')].some((i) => i.value === w), { timeout: 10000 }, want);
    console.log(`ok   deep link /${DESK}/hash-text: sha256("${text}") = ${want.slice(0, 16)}...`);
    ok = true;
  } catch (e) {
    console.log('FAIL', e.message.split('\n')[0]);
    await page.screenshot({ path: path.join(__dirname, 'fail.png') }).catch(() => {});
  }
  const uniq = [...new Set(errs)];
  console.log('page errors:', uniq.length ? '\n  ' + uniq.join('\n  ') : 'none');
  await browser.close();
  process.exit(ok && !uniq.length ? 0 : 1);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
