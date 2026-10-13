// Smoke test for the sqlime satellite: log in, open the bundled employees.db,
// run a query and check the result rows, then build a table in a new database.
// env: BASE_URL (default http://localhost:8202), SHIP_CODE, CHROME
const path = require('path');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(__dirname, '../../test/node_modules'), __dirname] }));
const BASE = (process.env.BASE_URL || 'http://localhost:8202').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'any';
const DESK = 'sqlime';

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
    // load the bundled demo database (served from /sqlime/employees.db)
    await page.goto(`${BASE}/${DESK}/#employees.db`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#result table'), { timeout: 60000 });
    console.log('ok   sqlite wasm loaded and opened employees.db');
    await page.click('#editor');
    await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type("select count(*) as n, sum(salary) as total, sqlite_version() as v from employees;");
    await page.click('#execute');
    await page.waitForFunction(() => {
      const cells = [...document.querySelectorAll('#result table td')].map((td) => td.textContent.trim());
      return cells[0] === '10' && cells[1] === '942' && /^3\./.test(cells[2] || '');
    }, { timeout: 15000 });
    const row = await page.evaluate(() => [...document.querySelectorAll('#result table td')].map((td) => td.textContent.trim()));
    console.log(`ok   query ran: count=${row[0]} sum(salary)=${row[1]} sqlite ${row[2]}`);
    // a fresh in-memory database through the UI: create, insert, select
    await page.goto(`${BASE}/${DESK}/`, { waitUntil: 'load' });
    await page.waitForSelector('#editor');
    await page.waitForFunction(() => /Run SQL|SQL/i.test(document.querySelector('#status')?.textContent || ''), { timeout: 30000 });
    await page.click('#editor');
    await page.keyboard.type("create table t(x); insert into t values (2),(3),(5); select group_concat(x, '+') as e, sum(x) as s from t;");
    await page.click('#execute');
    await page.waitForFunction(() => {
      const cells = [...document.querySelectorAll('#result table td')].map((td) => td.textContent.trim());
      return cells[0] === '2+3+5' && cells[1] === '10';
    }, { timeout: 15000 });
    console.log('ok   new database: create/insert/select -> 2+3+5 = 10');
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
