// Smoke test for the cyberchef satellite: log in, open a To Base64 recipe with
// input from the URL hash, check the output, then type new input and check again.
// env: BASE_URL (default http://localhost:8202), SHIP_CODE, CHROME
const path = require('path');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(__dirname, '../../test/node_modules'), __dirname] }));
const BASE = (process.env.BASE_URL || 'http://localhost:8202').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'any';
const DESK = 'cyberchef';

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
    const input = 'hello from urbit';
    const want = Buffer.from(input).toString('base64');
    const recipe = "To_Base64('A-Za-z0-9%2B/%3D')";
    await page.goto(`${BASE}/${DESK}/#recipe=${recipe}&input=${encodeURIComponent(Buffer.from(input).toString('base64'))}`, { waitUntil: 'load' });
    // the loader overlay goes away once the app (and ChefWorker) are ready
    await page.waitForFunction((w) => {
      const out = document.querySelector('#output-text .cm-content');
      return out && out.textContent.trim() === w;
    }, { timeout: 90000 }, want);
    console.log(`ok   recipe To_Base64 on "${input}" -> ${want}`);
    // change the input through the UI and check the output follows
    await page.evaluate(() => document.querySelector('#input-text .cm-content').focus());
    await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
    await page.keyboard.type('urbit');
    await page.waitForFunction(() => document.querySelector('#output-text .cm-content').textContent.trim() === 'dXJiaXQ=', { timeout: 30000 });
    console.log('ok   typed input "urbit" -> dXJiaXQ=');
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
