// End-to-end test: log in to the ship, then convert one file per converter
// through VERT's real UI served from /vert, and save the downloaded results.
// usage: SHIP_PORT=8098 SHIP_CODE=... CHROME=... node e2e.js
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const PORT = process.env.SHIP_PORT || 8098, CODE = process.env.SHIP_CODE;
const ORIGIN = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const BASE = `${ORIGIN}/vert`;
const OUT = path.join(__dirname, 'out');
const CASES = (process.env.CASES || 'md:docx,md:html,png:webp,png:jpg,wav:mp3,mp4:webm')
  .split(',').map((c) => c.split(':'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForDownload(before, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const done = fs.readdirSync(OUT).filter((f) => !before.has(f) && !f.endsWith('.crdownload'));
    if (done.length) return done[0];
    await sleep(250);
  }
  throw new Error('download timed out');
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT);
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1300, height: 1000 });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });
  await page.goto(`${ORIGIN}/~/login?redirect=/utilities/icon.svg`);
  await page.type('input[type=password]', CODE);
  await Promise.all([page.waitForNavigation().catch(() => {}), page.keyboard.press('Enter')]);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
    if (process.env.VERBOSE) console.log(`  [${m.type()}] ${m.text().slice(0, 300)}`);
  });
  page.on('requestfailed', (r) => errs.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });

  let failed = 0;
  for (const [from, to] of CASES) {
    const t0 = Date.now();
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'load' });
      // the file input is prerendered; wait for hydration (converter statuses go live)
      await page.waitForFunction(() => (document.body.innerText.match(/Status: ready/g) || []).length >= 3, { timeout: 120000 });
      const input = await page.waitForSelector('input[type=file]');
      await input.uploadFile(path.join(__dirname, 'samples', `sample.${from}`));
      await page.waitForFunction(() => location.pathname.startsWith('/vert/convert'), { timeout: 15000 });
      // open the format dropdown, search for the target, pick it
      const trigger = await page.waitForSelector('div.relative.w-full.min-w-fit > button:not([disabled])', { timeout: 30000 });
      await trigger.click();
      await page.waitForSelector('#format-search');
      await page.type('#format-search', to);
      await page.waitForFunction((to) => [...document.querySelectorAll('button[data-selected]')]
        .some((b) => b.textContent.trim() === `.${to}`), { timeout: 10000 }, to);
      await page.evaluate((to) => [...document.querySelectorAll('button[data-selected]')]
        .find((b) => b.textContent.trim() === `.${to}`).click(), to);
      // let the dropdown finish closing so clicks don't land on its overlay
      await sleep(1500);
      // convert once the converter's wasm is loaded (button enabled)
      const conv = await page.waitForSelector('button:has(svg.lucide-rotate-cw):not([disabled])', { timeout: 120000 });
      await conv.click();
      const dl = await page.waitForSelector('button:has(svg.lucide-download):not([disabled])', { timeout: 300000 });
      await sleep(500);
      let file;
      for (let attempt = 0; !file && attempt < 3; attempt++) {
        const before = new Set(fs.readdirSync(OUT));
        await dl.click();
        file = await waitForDownload(before, 10000).catch(() => null);
      }
      if (!file) throw new Error('download never arrived');
      const size = fs.statSync(path.join(OUT, file)).size;
      console.log(`ok   ${from} -> ${to}: ${file} (${size} bytes, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${from} -> ${to}: ${e.message.split('\n')[0]}`);
      await page.screenshot({ path: path.join(OUT, `fail-${from}-${to}.png`) });
    }
  }
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.screenshot({ path: path.join(OUT, 'home.png') });
  console.log('page errors:', errs.length ? '\n  ' + [...new Set(errs)].join('\n  ') : 'none');
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
