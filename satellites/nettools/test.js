// Smoke test for the nettools satellite: log in, load the home page, open the
// deep link /nettools/subnetting/ipv4-subnet-calculator and compute a subnet.
// env: BASE_URL (default http://localhost:8202), SHIP_CODE, CHROME
const path = require('path');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(__dirname, '../../test/node_modules'), __dirname] }));
const BASE = (process.env.BASE_URL || 'http://localhost:8202').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'any';
const DESK = 'nettools';

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
    await page.waitForFunction(() => /Subnet/.test(document.body.innerText), { timeout: 30000 });
    if (await page.evaluate(() => [...document.querySelectorAll('header a, nav a')].some((a) => /Lookups/.test(a.textContent))))
      throw new Error('server-only "Lookups" section is still in the nav');
    console.log('ok   home page loads, server-only Lookups section hidden');
    // deep link without trailing slash (served as subnetting/ipv4-subnet-calculator/index.html)
    await page.goto(`${BASE}/${DESK}/subnetting/ipv4-subnet-calculator`, { waitUntil: 'networkidle2' });
    const input = await page.waitForFunction(() => [...document.querySelectorAll('input')].find((i) => /\/\d+$/.test(i.value)), { timeout: 30000 });
    await input.evaluate((i) => { i.focus(); i.select(); });
    await page.keyboard.press('Backspace');
    await page.keyboard.type('10.20.0.0/22');
    await page.waitForFunction(() => {
      const t = document.body.innerText;
      return t.includes('10.20.3.255') && t.includes('1,022') && t.includes('255.255.252.0');
    }, { timeout: 15000 });
    console.log('ok   10.20.0.0/22 -> broadcast 10.20.3.255, mask 255.255.252.0, 1022 usable hosts');
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
