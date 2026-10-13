// Smoke test for the emulatorjs satellite: log in to the ship, open /emulatorjs/,
// load samples/240pee.nes (240p Test Suite, GPL-2.0+) through the file input,
// start it on the NES core and check the emulator canvas renders a non-blank frame.
// usage: BASE_URL=http://localhost:8205 SHIP_CODE=... CHROME=... node test.js
const path = require('path'), fs = require('fs');
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (e) {
  puppeteer = require(path.join(__dirname, '../../test/node_modules/puppeteer-core'));
}
const BASE = (process.env.BASE_URL || 'http://localhost:8205').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'x';
const CHROME = process.env.CHROME || `${process.env.HOME}/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome`;
const ROM = path.join(__dirname, 'samples', '240pee.nes');
const OUT = path.join(__dirname, 'out');
const ORIGIN = new URL(BASE).origin;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// decode a PNG screenshot in the page and measure how much of it is not flat
const frameStats = (page, b64) => page.evaluate(async (b64) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const colors = new Set(); let lit = 0;
  for (let i = 0; i < d.length; i += 4) {
    colors.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3));
    if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
  }
  return { w: c.width, h: c.height, colors: colors.size, lit: lit / (d.length / 4) };
}, b64);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const errs = [], external = [];
  let ok = false;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 850 });
    await page.goto(`${BASE}/~/login?redirect=/utilities/icon.svg`);
    await page.type('input[type=password]', CODE);
    await Promise.all([page.waitForNavigation().catch(() => {}), page.keyboard.press('Enter')]);

    page.on('pageerror', (e) => errs.push(`pageerror ${e.message}`));
    page.on('console', (m) => {
      if (process.env.VERBOSE || m.type() === 'error') console.log(`  [${m.type()}] ${m.text().slice(0, 300)}`);
    });
    page.on('request', (r) => {
      const u = r.url();
      if (/^https?:/.test(u) && new URL(u).origin !== ORIGIN) external.push(u);
    });
    page.on('requestfailed', (r) => {
      if (r.url().startsWith(ORIGIN)) errs.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`);
    });
    page.on('response', (r) => {
      if (r.status() >= 400 && r.url().startsWith(ORIGIN)) errs.push(`HTTP ${r.status()} ${r.url()}`);
    });

    await page.goto(`${BASE}/emulatorjs/`, { waitUntil: 'load' });
    const input = await page.waitForSelector('input#rom');
    await input.uploadFile(ROM);
    // the launcher guesses the system from the extension
    await page.waitForFunction(() => document.getElementById('system').value === 'nes'
      && !document.getElementById('start').disabled, { timeout: 5000 });
    await page.click('#start');
    await page.waitForFunction(() => window.EJS_emulator && window.EJS_emulator.started === true,
      { timeout: 120000, polling: 250 });
    console.log('emulator started; core:', await page.evaluate(() => window.EJS_emulator.getCore()));
    await sleep(4000);
    const canvas = await page.waitForSelector('#game canvas');
    const shot = path.join(OUT, 'emulatorjs.png');
    const b64 = await canvas.screenshot({ encoding: 'base64' });
    fs.writeFileSync(shot, Buffer.from(b64, 'base64'));
    const st = await frameStats(page, b64);
    console.log(`canvas ${st.w}x${st.h}: ${st.colors} colours, ${(st.lit * 100).toFixed(1)}% lit; screenshot ${shot}`);
    if (st.colors < 3 || st.lit < 0.01) throw new Error('emulator canvas is blank');
    ok = true;
  } catch (e) {
    console.log('FAIL', e.message.split('\n')[0]);
  }
  await browser.close();
  if (external.length) console.log('external requests:', [...new Set(external)].join(' '));
  if (errs.length) console.log('errors:\n  ' + errs.join('\n  '));
  const pass = ok && !errs.length && !external.length;
  console.log(pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
})();
