// Smoke test for /typst: log in to the ship, load the Typst editor, replace the
// document with a heading and some math, compile it in the browser (typst.ts
// wasm, local fonts), check the preview shows the heading, then download the
// PDF and check it is a real PDF.
// env: BASE_URL (default http://localhost:8204), SHIP_CODE, CHROME
const puppeteer = require('/home/amadeo/Research/vert-urbit/test/node_modules/puppeteer-core');
const BASE = process.env.BASE_URL || 'http://localhost:8204';
const DESK = 'typst';
const fs = require('fs'), os = require('os'), path = require('path');
const ORIGIN = new URL(BASE).origin;
let page;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'typst-test-'));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
  page = await browser.newPage(); await page.setViewport({ width: 1300, height: 1000 });
  await page.goto(`${BASE}/~/login?redirect=/utilities/icon.svg`);
  await page.type('input[type=password]', process.env.SHIP_CODE || 'x');
  await Promise.all([page.waitForNavigation().catch(() => {}), page.keyboard.press('Enter')]);

  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror ${e.message}`));
  // every request should go to the ship; count failures from it
  page.on('response', (r) => { if (r.url().startsWith(ORIGIN) && r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(ORIGIN) && r.failure()?.errorText !== 'net::ERR_ABORTED') errs.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`);
  });

  const external = new Set();
  page.on('request', (r) => { if (!r.url().startsWith(ORIGIN) && /^https?:/.test(r.url())) external.add(r.url()); });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });

  await page.goto(`${BASE}/${DESK}/`, { waitUntil: 'load' });
  await page.waitForSelector('textarea', { visible: true, timeout: 60000 });
  const word = `Urbit${Date.now() % 100000}`;
  const doc = `= Hello ${word}\n\nThe Pythagorean theorem: $a^2 + b^2 = c^2$.\n\n$ sum_(k=1)^n k = (n(n+1)) / 2 $\n`;
  await page.evaluate((doc) => {
    const ta = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, doc);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, doc);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Compile Now').click());
  // the preview (pdf.js text layer) shows the new heading once the wasm compiler has run
  await page.waitForFunction((word) => document.body.innerText.includes(`Hello ${word}`) &&
    [...document.querySelectorAll('.textLayer, canvas')].length > 0 &&
    [...document.querySelectorAll('.textLayer')].some((t) => t.innerText.includes(word)), { timeout: 180000 }, word);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Download PDF').click());
  let file;
  for (let i = 0; i < 60 && !file; i++) {
    await sleep(500);
    file = fs.readdirSync(dl).find((f) => f.endsWith('.pdf'));
  }
  if (!file) throw new Error('PDF download never arrived');
  const pdf = fs.readFileSync(path.join(dl, file));
  if (pdf.subarray(0, 5).toString() !== '%PDF-' || pdf.length < 2000) throw new Error(`not a PDF (${pdf.length} bytes)`);
  fs.rmSync(dl, { recursive: true, force: true });
  console.log(`compiled "= Hello ${word}" with math; downloaded ${file} (${pdf.length} bytes)`);
  if (external.size) errs.push(`external requests: ${[...external].join(' ')}`);
  await sleep(1000);
  await browser.close();
  if (errs.length) { console.log('errors:\n  ' + [...new Set(errs)].join('\n  ')); process.exit(1); }
  console.log('PASS');
})().catch(async (e) => {
  console.error('FAILED', e.message);
  if (page) {
    console.error('at', page.url());
    console.error((await page.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 600));
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT }).catch(() => {});
  }
  process.exit(1);
});
