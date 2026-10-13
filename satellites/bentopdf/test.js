// Smoke test for the bentopdf satellite: log in, open /bentopdf/, go to the
// Merge PDF tool, merge samples/a.pdf (1 page) and samples/b.pdf (2 pages),
// download the result and check it is a 3-page PDF.
// usage: BASE_URL=http://localhost:8201 SHIP_CODE=... CHROME=... node test.js
const path = require('path'), fs = require('fs'), os = require('os');
const puppeteer = require(process.env.PUPPETEER || path.join(__dirname, '../../test/node_modules/puppeteer-core'));
const BASE = (process.env.BASE_URL || 'http://localhost:8201').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'test';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'bentopdf-test-'));
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
    page.on('dialog', (d) => d.dismiss());

    // home page, then follow the tool card like a user would
    await page.goto(`${BASE}/bentopdf/`, { waitUntil: 'networkidle0' });
    // on the first visit the service worker takes control and the page reloads
    // once to become cross-origin isolated (needed by the LibreOffice tools)
    let isolated = false;
    for (let i = 0; i < 60 && !isolated; i++) {
      isolated = await page.evaluate(() => self.crossOriginIsolated).catch(() => false);
      if (!isolated) await sleep(500);
    }
    if (!isolated) throw new Error('page never became cross-origin isolated (service worker)');
    const link = await page.waitForSelector('a[href$="merge-pdf.html"]', { timeout: 30000 });
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), link.evaluate((a) => a.click())]);
    if (!page.url().startsWith(`${BASE}/bentopdf/merge-pdf`)) throw new Error(`unexpected page ${page.url()}`);

    const input = await page.waitForSelector('#file-input');
    await input.uploadFile(path.join(__dirname, 'samples', 'a.pdf'), path.join(__dirname, 'samples', 'b.pdf'));
    await page.waitForFunction(() => document.querySelectorAll('#file-list li').length === 2, { timeout: 30000 });
    await page.click('#process-btn');
    const end = Date.now() + 120000;
    let file;
    while (!file && Date.now() < end) {
      file = fs.readdirSync(OUT).find((f) => f.endsWith('.pdf'));
      if (!file) await sleep(250);
    }
    if (!file) throw new Error('merged PDF was never downloaded');
    await sleep(500);
    const buf = fs.readFileSync(path.join(OUT, file));
    const pages = await page.evaluate(async (b64) => {
      // count pages with the app's own pdf.js build (served by the desk)
      const pdfjs = await import(new URL('pdfjs-viewer/pdf.mjs', location.href.replace(/[^/]*$/, '')).href);
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-viewer/pdf.worker.mjs', location.href.replace(/[^/]*$/, '')).href;
      const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return (await pdfjs.getDocument({ data }).promise).numPages;
    }, buf.toString('base64'));
    console.log(`downloaded ${file}: ${buf.length} bytes, ${pages} pages`);
    if (buf.subarray(0, 5).toString() !== '%PDF-') throw new Error('download is not a PDF');
    if (pages !== 3) throw new Error(`expected 3 pages, got ${pages}`);
    if (errs.length) throw new Error('page errors:\n  ' + [...new Set(errs)].join('\n  '));
    ok = true;
    console.log('PASS bentopdf: merge 1+2 pages -> 3-page PDF');
  } catch (e) {
    console.error('FAIL bentopdf:', e.message);
  } finally {
    await browser.close();
    fs.rmSync(OUT, { recursive: true, force: true });
    process.exit(ok ? 0 : 1);
  }
})();
