// Smoke test for the jsdos satellite: log in to the ship, open /jsdos/, load
// samples/plasma.zip (a plain zip, the launcher builds the bundle) and then
// samples/plasma.jsdos (a ready bundle) through the file input, and check that
// DOSBox runs: the canvas shows a non-blank, animating VGA frame.
// usage: BASE_URL=http://localhost:8205 SHIP_CODE=... CHROME=... node test.js
const path = require('path'), fs = require('fs');
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (e) {
  puppeteer = require(path.join(__dirname, '../../test/node_modules/puppeteer-core'));
}
const BASE = (process.env.BASE_URL || 'http://localhost:8205').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'x';
const CHROME = process.env.CHROME || `${process.env.HOME}/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome`;
const OUT = path.join(__dirname, 'out');
const ORIGIN = new URL(BASE).origin;
// each case is <sample>[:<backend>], backend dosbox (default) or dosboxX
const CASES = (process.env.CASES || 'plasma.zip,plasma.jsdos,plasma.zip:dosboxX').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// decode a PNG screenshot in the page; count colours and a coarse fingerprint
const frameStats = (page, b64) => page.evaluate(async (b64) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const colors = new Set(); let lit = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    colors.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3));
    if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    sum = (sum * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) % 1000000007;
  }
  return { w: c.width, h: c.height, colors: colors.size, lit: lit / (d.length / 4), hash: sum };
}, b64);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const errs = [], external = [];
  let failed = 0;
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 800 });
  await page.goto(`${BASE}/~/login?redirect=/utilities/icon.svg`);
  await page.type('input[type=password]', CODE);
  await Promise.all([page.waitForNavigation().catch(() => {}), page.keyboard.press('Enter')]);

  page.on('pageerror', (e) => errs.push(`pageerror ${e.message}`));
  page.on('console', (m) => {
    if (process.env.VERBOSE || m.type() === 'error') console.log(`  [${m.type()}] ${m.text().slice(0, 300)}`);
  });
  const seen = [];
  page.on('request', (r) => {
    const u = r.url();
    seen.push(u);
    if (/^(https?|wss?):/.test(u) && new URL(u).origin !== ORIGIN) external.push(u);
  });
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(ORIGIN)) errs.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(ORIGIN)) errs.push(`HTTP ${r.status()} ${r.url()}`);
  });

  for (const c of CASES) {
    const [sample, backend = 'dosbox'] = c.split(':');
    const t0 = Date.now();
    seen.length = 0;
    try {
      await page.goto(`${BASE}/jsdos/`, { waitUntil: 'load' });
      await page.waitForFunction(() => typeof window.Dos === 'function', { timeout: 30000 });
      const input = await page.waitForSelector('input#file');
      await input.uploadFile(path.join(__dirname, 'samples', sample));
      await page.waitForFunction(() => !document.getElementById('start').disabled, { timeout: 10000 });
      if (sample.endsWith('.zip')) {
        const run = await page.$eval('#run', (s) => s.value);
        if (run !== 'PLASMA.COM') throw new Error(`launcher picked "${run}" to run`);
      }
      await page.select('#backend', backend);
      await page.click('#start');
      const canvas = await page.waitForSelector('#dos canvas', { timeout: 60000 });
      // wait for the program to switch to VGA mode 13h and draw (lots of colours)
      let st, prev = null, ok = false;
      for (let i = 0; i < 60 && !ok; i++) {
        await sleep(1000);
        const b64 = await canvas.screenshot({ encoding: 'base64' }).catch(() => null);
        if (!b64) continue;
        st = await frameStats(page, b64);
        if (st.colors >= 32 && st.lit > 0.2 && prev && prev.hash !== st.hash && prev.colors >= 32) {
          ok = true;
          fs.writeFileSync(path.join(OUT, `jsdos-${sample}-${backend}.png`), Buffer.from(b64, 'base64'));
        }
        prev = st;
      }
      if (!ok) {
        await page.screenshot({ path: path.join(OUT, `fail-${sample}.png`) });
        throw new Error(`no animating VGA frame (last: ${JSON.stringify(st)})`);
      }
      const wasm = backend === 'dosboxX' ? 'wdosbox-x.wasm' : 'wdosbox.wasm';
      if (!seen.some((u) => u.endsWith('/' + wasm))) throw new Error(`${wasm} was never loaded`);
      console.log(`ok   ${sample} (${backend}): canvas ${st.w}x${st.h}, ${st.colors} colours, ${(st.lit * 100).toFixed(0)}% lit, animating (${((Date.now() - t0) / 1000).toFixed(1)}s); out/jsdos-${sample}-${backend}.png`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${sample} (${backend}): ${e.message.split('\n')[0]}`);
    }
  }
  await browser.close();
  if (external.length) console.log('external requests:', [...new Set(external)].join(' '));
  if (errs.length) console.log('errors:\n  ' + errs.join('\n  '));
  const pass = !failed && !errs.length && !external.length;
  console.log(pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
})();
