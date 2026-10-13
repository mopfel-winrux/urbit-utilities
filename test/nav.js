// Check in-app navigation under /vert, deep links, and service worker scope.
const puppeteer = require('puppeteer-core');
const PORT = process.env.SHIP_PORT || 8098, CODE = process.env.SHIP_CODE;
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1300, height: 1000 });
  await page.goto(`http://localhost:${PORT}/~/login`);
  await page.type('input[type=password]', CODE);
  await Promise.all([page.waitForNavigation().catch(() => {}), page.keyboard.press('Enter')]);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(`http://localhost:${PORT}/vert/`, { waitUntil: 'load' });
  await page.waitForFunction(() => /Status: ready/.test(document.body.innerText), { timeout: 60000 });
  for (const label of ['Settings', 'About', 'Convert', 'Upload']) {
    await page.evaluate((l) => [...document.querySelectorAll('nav a, a')].find((a) => a.textContent.trim() === l).click(), label);
    await new Promise((r) => setTimeout(r, 1200));
    console.log(`click ${label.padEnd(8)} -> ${new URL(page.url()).pathname}`);
  }
  for (const p of ['settings/', 'about', 'privacy/', 'debug/']) {
    await page.goto(`http://localhost:${PORT}/vert/${p}`, { waitUntil: 'load' });
    console.log(`deep link /vert/${p.padEnd(9)} -> title "${await page.title()}"`);
  }
  await page.screenshot({ path: 'out/settings.png' });
  const sw = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope || 'none');
  console.log('service worker scope:', sw);
  console.log('errors:', errs.length ? '\n  ' + [...new Set(errs)].join('\n  ') : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
