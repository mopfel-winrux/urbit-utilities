// Smoke test for the mermaid satellite: log in, open a deep link
// (/mermaid/edit#base64:...) with a diagram in the URL, check it renders to SVG,
// then edit the code in the editor and check the SVG updates.
// env: BASE_URL (default http://localhost:8202), SHIP_CODE, CHROME
const path = require('path');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(__dirname, '../../test/node_modules'), __dirname] }));
const BASE = (process.env.BASE_URL || 'http://localhost:8202').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'any';
const DESK = 'mermaid';

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
    const state = { code: 'graph TD\n  Urbit[Urbit ship] --> Satellite[Mermaid satellite]', mermaid: '{"theme":"default"}', autoSync: true, updateDiagram: true };
    const hash = 'base64:' + Buffer.from(JSON.stringify(state)).toString('base64');
    await page.goto(`${BASE}/${DESK}/edit#${hash}`, { waitUntil: 'load' });
    await page.waitForFunction(() => /Mermaid satellite/.test(document.querySelector('#container svg')?.textContent || ''), { timeout: 60000 });
    console.log('ok   deep link /mermaid/edit rendered the diagram from the URL');
    // type a new diagram into the monaco editor
    await page.waitForSelector('.monaco-editor textarea', { timeout: 30000 });
    await page.click('.monaco-editor .view-lines');
    await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('sequenceDiagram\nAlice->>Bob: hello from urbit\n');
    await page.waitForFunction(() => {
      const svg = document.querySelector('#container svg');
      return svg && /hello from urbit/.test(svg.textContent) && svg.getAttribute('aria-roledescription') === 'sequence';
    }, { timeout: 30000 });
    const n = await page.evaluate(() => document.querySelector('#container svg').outerHTML.length);
    console.log(`ok   typed sequence diagram rendered to SVG (${n} bytes)`);
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
