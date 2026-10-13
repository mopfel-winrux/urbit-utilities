// JupyterLite smoke test: log in, create a notebook, run numpy in the Pyodide
// kernel, save it (JupyterLab asks to rename an untitled notebook), check the
// notebook is in the ship store, then open a fresh browser profile (no
// IndexedDB, no service worker), find it in the file browser and reopen it.
// Conflicts: another writer PUTs the notebook behind JupyterLite's back, so the
// next save must get JupyterLab's "File Changed" dialog and leave the other
// version stored until Overwrite; and a write that races the save itself (after
// JupyterLab's check) must get 412 from the drive's If-Match, not overwrite.
// usage: BASE_URL=http://localhost:8207 SHIP_CODE=... CHROME=... node test.js
const path = require('path');
const puppeteer = require(path.join(__dirname, '../../test/node_modules/puppeteer-core'));
const BASE = (process.env.BASE_URL || 'http://localhost:8207').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'x';
const CHROME = process.env.CHROME || `${process.env.HOME}/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome`;
const ORIGIN = new URL(BASE).origin;
const SRC = 'import numpy; print(numpy.arange(3).sum())';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errs = [];
const allowed = new Set(); // "STATUS METHOD url" responses a step expects
let allowedPageError = null; // and a page error it expects
const step = (s) => console.log(`- ${s}`);

async function loggedInPage(ctx) {
  const page = await ctx.newPage();
  await page.setViewport({ width: 1400, height: 950 });
  page.setDefaultTimeout(120000);
  await page.goto(`${BASE}/~/login?redirect=/utilities/icon.svg`);
  await page.type('input[type=password]', CODE);
  await Promise.all([page.waitForNavigation().catch(() => {}), page.keyboard.press('Enter')]);
  page.on('pageerror', (e) => allowedPageError?.test(e.message) || errs.push(`pageerror ${e.message}`));
  page.on('console', (m) => process.env.VERBOSE && console.log(`  [${m.type()}] ${m.text().slice(0, 300)}`));
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText || '';
    if (r.url().startsWith(ORIGIN) && !/ERR_ABORTED/.test(why)) errs.push(`requestfailed ${r.url()} ${why}`);
  });
  page.on('request', (r) => {
    const u = r.url();
    if (/^https?:/.test(u) && !u.startsWith(ORIGIN)) errs.push(`external request ${u}`);
  });
  page.on('response', (r) => {
    if (allowed.has(`${r.status()} ${r.request().method()} ${r.url()}`)) return;
    if (r.url().startsWith(ORIGIN) && r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return page;
}

const DAVP = '/utilities/dav/jupyter/';
const readNb = (page, name) => page.evaluate(async (name) =>
  (await fetch('/utilities/api/store/jupyter/' + encodeURIComponent(name), { cache: 'no-store' })).json(), name);
// another client: a plain PUT of the stored notebook with a marker, no If-Match
const otherWrite = (page, name, mark) => page.evaluate(async (dav, name, mark) => {
  const u = dav + encodeURIComponent(name);
  const nb = await (await fetch(u, { cache: 'no-store' })).json();
  nb.metadata.other_writer = mark;
  const r = await fetch(u, { method: 'PUT', headers: { 'Content-Type': 'application/x-ipynb+json', 'X-Test-Other': '1' },
    body: JSON.stringify(nb, null, 1) });
  return r.status;
}, DAVP, name, mark);
const cellText = (page) => page.$eval('.jp-NotebookPanel:not(.lm-mod-hidden) .jp-Cell .cm-content', (c) => c.textContent);
async function typeInCell(page, text) {
  const before = await cellText(page);
  await page.click('.jp-NotebookPanel:not(.lm-mod-hidden) .jp-Cell .cm-content');
  await page.keyboard.press('End');
  await page.keyboard.type(text, { delay: 20 });
  await page.waitForFunction((t) => document.querySelector('.jp-NotebookPanel:not(.lm-mod-hidden) .jp-Cell .cm-content')
    .textContent.endsWith(t), { timeout: 10000 }, before + text);
}
const save = async (page) => {
  await page.keyboard.down('Control'); await page.keyboard.press('s'); await page.keyboard.up('Control');
};
const dialog = (page, re) => page.waitForFunction((re) => {
  const d = document.querySelector('.jp-Dialog');
  return d && new RegExp(re).test(d.innerText) ? d.innerText : null;
}, { timeout: 20000 }, re).then((h) => h.jsonValue());
const clickButton = (page, label) => page.evaluate((label) => {
  const b = [...document.querySelectorAll('.jp-Dialog button')].find((b) => new RegExp(`^(${label})$`, 'i').test(b.innerText.trim()));
  if (!b) throw new Error(`no ${label} button in ${JSON.stringify([...document.querySelectorAll('.jp-Dialog button')].map((b) => b.outerHTML.slice(0, 200)))}`);
  b.click();
}, label);
const srcOf = (nb) => nb.cells.map((c) => [].concat(c.source).join('')).join('\n');

async function conflicts(page, name) {
  const puts = []; // headers of JupyterLite's own PUTs of the notebook
  const url = ORIGIN + DAVP + encodeURIComponent(name);
  const onReq = (r) => { if (r.method() === 'PUT' && r.url() === url && !r.headers()['x-test-other']) puts.push(r.headers()); };
  page.on('request', onReq);

  step('conflict 1: another writer saves the notebook, then JupyterLite saves');
  if ((await otherWrite(page, name, 'one')) !== 204) throw new Error('other writer PUT failed');
  await typeInCell(page, '  # mine-1');
  const nput = puts.length;
  await save(page);
  const msg = await dialog(page, 'File Changed');
  if (!/changed on disk/.test(msg)) throw new Error(`unexpected dialog: ${msg}`);
  await sleep(1000);
  let nb = await readNb(page, name);
  if (nb.metadata.other_writer !== 'one' || srcOf(nb).includes('mine-1') || puts.length !== nput)
    throw new Error('the conflicting save overwrote the other writer');
  step('JupyterLab shows "File Changed"; the store still has the other writer\'s version');
  await clickButton(page, 'Overwrite');
  await page.waitForFunction(async (u) => {
    const nb = await (await fetch(u, { cache: 'no-store' })).json();
    return nb.cells.some((c) => [].concat(c.source).join('').includes('mine-1'));
  }, { timeout: 20000, polling: 500 }, url);
  nb = await readNb(page, name);
  if (nb.metadata.other_writer) throw new Error('overwrite kept the other version');
  if (!puts[puts.length - 1]['if-match']) throw new Error('the save had no If-Match');
  step(`Overwrite stored ours (PUT If-Match: ${puts[puts.length - 1]['if-match']})`);
  await page.waitForFunction(() => !document.querySelector('.jp-Dialog'), { timeout: 10000 });
  await sleep(1000);

  step('conflict 2: another writer races the save itself (after JupyterLab\'s check)');
  await typeInCell(page, '  # mine-2');
  allowed.add(`412 PUT ${url}`);
  // JupyterLab's save command rethrows every failed save after its error
  // dialog, so the 412 also shows up as an unhandled rejection
  allowedPageError = /was changed on the ship by someone else/;
  await page.setRequestInterception(true);
  let raced = false;
  const onIntercept = async (r) => {
    if (r.isInterceptResolutionHandled()) return;
    if (!raced && r.method() === 'PUT' && r.url() === url && !r.headers()['x-test-other']) {
      raced = true;
      // write from Node with the page's cookies while the save is held back
      const cookie = (await page.cookies(ORIGIN)).map((c) => `${c.name}=${c.value}`).join('; ');
      const g = await fetch(url, { headers: { cookie } });
      const other = await g.json();
      other.metadata.other_writer = 'two';
      const p = await fetch(url, { method: 'PUT', headers: { cookie, 'Content-Type': 'application/x-ipynb+json' },
        body: JSON.stringify(other, null, 1) });
      if (p.status !== 204) errs.push(`race writer PUT ${p.status}`);
    }
    r.continue();
  };
  page.on('request', onIntercept);
  await save(page);
  const err = await dialog(page, 'changed on the ship by someone else');
  page.off('request', onIntercept);
  await page.setRequestInterception(false);
  if (!raced) throw new Error('the save was not intercepted');
  nb = await readNb(page, name);
  if (nb.metadata.other_writer !== 'two' || srcOf(nb).includes('mine-2'))
    throw new Error('the raced save overwrote the other writer');
  step(`the drive's PUT got 412; error dialog: "${err.split('\n')[0]}"; store kept the other version`);
  await clickButton(page, 'Close|Ok|Dismiss');
  allowedPageError = null;
  await page.waitForFunction(() => !document.querySelector('.jp-Dialog'), { timeout: 10000 });
  step('save again: JupyterLab offers Overwrite / Revert; choose Revert');
  await save(page);
  await dialog(page, 'File Changed');
  await clickButton(page, 'Revert');
  await page.waitForFunction(() => !document.querySelector('.jp-Dialog'), { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('.jp-NotebookPanel:not(.lm-mod-hidden) .jp-Cell .cm-content')
    .textContent.includes('mine-2'), { timeout: 10000 });
  nb = await readNb(page, name);
  if (nb.metadata.other_writer !== 'two') throw new Error('revert changed the stored notebook');
  step('Revert loaded the other version (mine-2 gone, store unchanged)');
  // a plain save after the revert goes through (If-Match is the reloaded tag)
  await typeInCell(page, '  # mine-3');
  await save(page);
  await page.waitForFunction(async (u) => {
    const nb = await (await fetch(u, { cache: 'no-store' })).json();
    return nb.cells.some((c) => [].concat(c.source).join('').includes('mine-3')) && nb.metadata.other_writer === 'two';
  }, { timeout: 20000, polling: 500 }, url);
  if (await page.$('.jp-Dialog')) throw new Error('unexpected dialog after a clean save');
  step('a save after Revert stores ours on top of it without a dialog');
  page.off('request', onReq);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const t0 = Date.now();
  let page, name;
  try {
    page = await loggedInPage(browser.defaultBrowserContext());
    const created = [];
    page.on('request', (r) => r.method() === 'PUT' && r.url().includes(DAVP) && created.push([r.url(), r.headers()]));
    step('open /jupyter/');
    await page.goto(`${BASE}/jupyter/`, { waitUntil: 'load' });
    const card = await page.waitForSelector('.jp-LauncherCard[data-category="Notebook"]', { timeout: 180000 });

    step('new notebook');
    await card.click();
    await page.waitForSelector('.jp-NotebookPanel .jp-Cell .cm-content', { timeout: 60000 });
    const untitled = await page.waitForFunction(() => {
      const t = document.querySelector('.lm-DockPanel .lm-TabBar-tab.lm-mod-current .lm-TabBar-tabLabel');
      return t && /\.ipynb$/.test(t.textContent) ? t.textContent : null;
    }, { timeout: 30000 }).then((h) => h.jsonValue());
    const first = created.find(([u]) => u.endsWith(DAVP + encodeURIComponent(untitled)));
    if (!first || first[1]['if-none-match'] !== '*') throw new Error(`new notebook PUT is not create-only: ${JSON.stringify(first)}`);
    step(`created ${untitled} (PUT If-None-Match: *)`);
    name = `ship-test-${Date.now()}.ipynb`;

    step('wait for the Pyodide kernel');
    await page.waitForFunction(() => /Python \(Pyodide\) \| Idle/.test(document.querySelector('#jp-main-statusbar')?.innerText || ''),
      { timeout: 300000 });
    await sleep(1000);
    step('run numpy');
    await page.click('.jp-NotebookPanel .jp-Cell .cm-content');
    await page.keyboard.type(SRC, { delay: 20 });
    await page.waitForFunction((src) => document.querySelector('.jp-NotebookPanel .jp-Cell .cm-content').textContent === src,
      { timeout: 10000 }, SRC);
    await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
    await page.waitForFunction(() => {
      const o = document.querySelector('.jp-NotebookPanel .jp-Cell .jp-OutputArea-output');
      return o && o.textContent.trim().length > 0;
    }, { timeout: 300000 });
    const out = await page.$eval('.jp-NotebookPanel .jp-Cell .jp-OutputArea-output', (o) => o.textContent.trim());
    if (out !== '3') throw new Error(`unexpected output: ${JSON.stringify(out)}`);
    step(`output ${out} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

    step(`save as ${name}`);
    await page.keyboard.down('Control'); await page.keyboard.press('s'); await page.keyboard.up('Control');
    const input = await page.waitForSelector('.jp-Dialog input', { timeout: 20000 });
    await input.click({ count: 3 });
    await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    // the save (PUT) and rename (MOVE) go to /utilities/dav/jupyter/; wait for the store to have it
    await page.waitForFunction(async (name) => {
      const list = await (await fetch('/utilities/api/store/jupyter/')).json();
      return list.some((i) => i.path === name);
    }, { timeout: 60000, polling: 1000 }, name);
    await page.waitForFunction(() => !document.querySelector('.jp-Dialog'), { timeout: 10000 });
    await sleep(1500);

    step('check the ship store');
    const stored = await page.evaluate(async (name) => {
      const list = await (await fetch('/utilities/api/store/jupyter/')).json();
      const it = list.find((i) => i.path === name);
      const nb = await (await fetch('/utilities/api/store/jupyter/' + encodeURIComponent(name))).json();
      return { it, nb };
    }, name);
    const cell = stored.nb.cells.find((c) => [].concat(c.source).join('').includes('numpy.arange(3)'));
    const text = cell && cell.outputs.map((o) => [].concat(o.text || '').join('')).join('').trim();
    if (text !== '3') throw new Error(`stored notebook lacks the output: ${JSON.stringify(stored.nb).slice(0, 400)}`);
    step(`stored ${name}: ${stored.it.size} bytes, ${stored.it.type}, output "3" saved`);

    await conflicts(page, name);
    await page.close();

    step('fresh browser profile: reopen from the file browser');
    const ctx = await browser.createBrowserContext();
    page = await loggedInPage(ctx);
    await page.goto(`${BASE}/jupyter/lab/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('.jp-DirListing-content', { timeout: 180000 });
    // the listing re-renders while it loads, so locate the row by name each time
    const rowBox = (name) => page.waitForFunction((name) => {
      const el = [...document.querySelectorAll('.jp-DirListing-item')]
        .find((e) => e.querySelector('.jp-DirListing-itemText')?.textContent.trim() === name);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width ? { x: r.x + 40, y: r.y + r.height / 2 } : null;
    }, { timeout: 60000 }, name).then((h) => h.jsonValue());
    await rowBox(name);
    await sleep(1500);
    const { x, y } = await rowBox(name);
    await page.mouse.click(x, y, { count: 2 });
    await page.waitForFunction(() => {
      const p = document.querySelector('.jp-NotebookPanel:not(.lm-mod-hidden)');
      const c = p && p.querySelector('.jp-Cell .cm-content');
      const o = p && p.querySelector('.jp-Cell .jp-OutputArea-output');
      return c && c.textContent.includes('numpy.arange(3)') && o && o.textContent.trim() === '3';
    }, { timeout: 60000 });
    step('reopened notebook shows the code and the output 3');
    // let the reopened notebook's kernel start so its requests are checked too
    await page.waitForFunction(() => /Python \(Pyodide\) \| Idle/.test(document.querySelector('#jp-main-statusbar')?.innerText || ''),
      { timeout: 300000 });
  } catch (e) {
    errs.push(`FAIL ${e.message.split('\n')[0]}`);
    if (page) await page.screenshot({ path: path.join(__dirname, 'test-fail.png') }).catch(() => {});
  }
  if (name && page && !page.isClosed()) {
    await page.evaluate((name) => fetch('/utilities/api/store/jupyter/' + encodeURIComponent(name), { method: 'DELETE' }), name)
      .catch(() => {});
  }
  await browser.close();
  if (errs.length) {
    console.log('FAIL\n  ' + errs.join('\n  '));
    process.exit(1);
  }
  console.log(`PASS (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
})().catch((e) => { console.error(e); process.exit(1); });
