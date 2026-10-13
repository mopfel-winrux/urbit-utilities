// Headless smoke test: log in, load the page, poke through the UI, check the scry.
// needs: node >= 18, `npm i puppeteer-core`, and a Chrome/Chromium binary (CHROME env var).
// usage: SHIP_PORT=8081 CHROME=/path/to/chrome node tools/smoke.js [app=myapp]
const puppeteer = require('puppeteer-core');
const APP = process.argv[2] || 'myapp', PORT = process.env.SHIP_PORT || 8081, CODE = process.env.SHIP_CODE || 'lidlut-tabwed-pillex-ridrup';
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1200, height: 900 });
  const errs = [];
  await page.goto(`http://localhost:${PORT}/~/login`, { waitUntil: 'networkidle0' });
  await page.type('input[type=password]', CODE);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), page.keyboard.press('Enter')]);
  await page.goto('about:blank');   // leave Landscape (its own console noise) before listening for errors
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/${APP}/`, { waitUntil: 'load', timeout: 60000 });   // not networkidle0: the SSE channel never goes idle
  await page.waitForFunction(() => /items/.test(document.querySelector('#status').textContent), { timeout: 30000 });
  await page.type('#text', 'smoke test item'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#items li[data-id]').length > 0, { timeout: 10000 });
  await page.screenshot({ path: 'smoke.png' });
  const state = await page.evaluate((app) => fetch(`/~/scry/${app}/state.json`).then((r) => r.json()), APP);
  console.log('items on ship:', state.items.length, '| page errors:', errs.join('; ') || 'none');
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
