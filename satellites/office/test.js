// %office end-to-end test: log in, start LibreOffice (ZetaOffice wasm), create
// a Writer document, type text, save it to the ship's store, reload, reopen
// it from the ship and check the text. Then edit, save with LibreOffice's own
// Ctrl+S, reopen and check again; "Save as" .docx. Then conflicts: another
// writer PUTs the same store item behind the app's back; the app's save must
// get 412, keep the other bytes and show the conflict dialog, resolved once
// with "Save mine as a copy", once with "Overwrite", once with "Reload theirs".
// usage: BASE_URL=http://localhost:8207 SHIP_CODE=... CHROME=... node test.js
const puppeteer = require(process.env.PUPPETEER || '/home/amadeo/Research/vert-urbit/test/node_modules/puppeteer-core');
const os = require('os'), path = require('path');
const BASE = (process.env.BASE_URL || 'http://localhost:8207').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'x';
const STORE = '/utilities/api/store/office/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME, headless: true, protocolTimeout: 900000,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1300, height: 900 });
  page.setDefaultTimeout(120000);
  await page.goto(`${BASE}/~/login?redirect=/utilities/icon.svg`);
  await page.type('input[type=password]', CODE);
  await Promise.all([page.waitForNavigation().catch(() => {}), page.keyboard.press('Enter')]);

  const errs = [];
  const origin = new URL(BASE).origin;
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    // ERR_ABORTED: the first visit reloads once the COOP/COEP worker is active
    if (r.url().startsWith(origin) && r.failure()?.errorText !== 'net::ERR_ABORTED') errs.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(origin) && !/^(data|blob|about):/.test(u)) errs.push(`external request ${u}`);
  });
  const expect412 = new Set();  // store URLs where a 412 is the point of the test
  page.on('response', (r) => {
    if (r.status() === 412 && expect412.has(r.url())) { expect412.delete(r.url()); return; }
    if (r.url().startsWith(origin) && r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`);
  });
  if (process.env.VERBOSE) page.on('console', (m) => console.log(`  [${m.type()}] ${m.text().slice(0, 200)}`));
  const check = (what) => { if (errs.length) throw new Error(`${what}: ${errs.join('; ')}`); };

  const boot = async () => {
    const t0 = Date.now();
    await page.goto(`${BASE}/office/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.officeReady || document.getElementById('fatal')?.textContent,
      { timeout: 600000 });
    const fatal = await page.$eval('#fatal', (e) => e.textContent);
    if (fatal) throw new Error(`office failed to start: ${fatal}`);
    log(`LibreOffice ready in ${((Date.now() - t0) / 1000).toFixed(1)}s, crossOriginIsolated=${await page.evaluate(() => crossOriginIsolated)}`);
  };
  const docPath = () => page.evaluate(() => window.office.state().doc?.path || null);
  const text = () => page.evaluate(() => window.office.text());
  const waitSaved = (p) => page.waitForFunction((p) => document.getElementById('status').textContent === `Saved ${p} to your ship`, { timeout: 120000 }, p);
  const listing = () => page.evaluate((s) => fetch(s).then((r) => r.json()), STORE);
  const reopen = async (p) => {
    await boot();
    await page.waitForFunction((p) => [...document.querySelectorAll('#files td.name a')].some((a) => a.textContent === p), {}, p);
    await page.evaluate((p) => [...document.querySelectorAll('#files td.name a')].find((a) => a.textContent === p).click(), p);
    await page.waitForFunction((p) => window.office.state().doc?.path === p && document.getElementById('loading').classList.contains('hidden'), {}, p);
    await sleep(1500);
  };
  const typeIntoDoc = async (s) => {
    await page.mouse.click(650, 450);
    await sleep(500);
    await page.keyboard.type(s, { delay: 25 });
    await sleep(1000);
  };

  const stamp = Date.now().toString(36);
  const name = `e2e-${stamp}`;
  const file = `${name}.odt`;
  const phrase = `Hello from Urbit ${stamp}`;
  try {
    await boot();

    // 1. new Writer document, type, save to ship through the Save dialog
    await page.click('[data-new=writer]');
    await page.waitForFunction(() => window.office.state().doc && document.getElementById('loading').classList.contains('hidden'));
    await sleep(2000);
    await typeIntoDoc(phrase);
    let t = await text();
    if (!t.includes(phrase)) throw new Error(`typed text not in document: ${JSON.stringify(t)}`);
    log('typed into new document');
    await page.click('#btnSave');
    await page.waitForSelector('#saveDlg[open]');
    await page.$eval('#saveName', (e) => { e.value = ''; });
    await page.type('#saveName', name);
    await page.select('#saveFmt', 'odt');
    await page.click('#saveOk');
    await waitSaved(file);
    const row = (await listing()).find((r) => r.path === file);
    if (!row || row.size < 1000) throw new Error(`${file} not in the ship store: ${JSON.stringify(row)}`);
    log(`saved ${file} to the ship (${row.size} bytes, ${row.type})`);
    check('after save');

    // 2. reload, reopen from the ship, check the text
    await reopen(file);
    t = await text();
    if (!t.includes(phrase)) throw new Error(`reopened text mismatch: ${JSON.stringify(t)}`);
    log(`reopened ${file} from the ship: text ok`);

    // 3. edit and save with LibreOffice's own Ctrl+S, reopen, check
    await page.mouse.click(650, 450); await sleep(500);
    await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control');
    await page.keyboard.type(' edited', { delay: 25 });
    await sleep(1000);
    await page.keyboard.down('Control'); await page.keyboard.press('s'); await page.keyboard.up('Control');
    await waitSaved(file);
    log('Ctrl+S uploaded the document');
    await reopen(file);
    t = await text();
    if (!t.includes(`${phrase} edited`)) throw new Error(`text after Ctrl+S mismatch: ${JSON.stringify(t)}`);
    log('reopened after Ctrl+S: text ok');

    // 4. Save as .docx
    await page.click('#btnSaveAs');
    await page.waitForSelector('#saveDlg[open]');
    await page.select('#saveFmt', 'docx');
    await page.click('#saveOk');
    await waitSaved(`${name}.docx`);
    const docx = (await listing()).find((r) => r.path === `${name}.docx`);
    if (!docx || docx.size < 1000) throw new Error('docx not stored');
    if (await docPath() !== `${name}.docx`) throw new Error('document path did not switch to the docx');
    log(`saved as ${name}.docx (${docx.size} bytes)`);
    check('after save as');

    // 5. concurrent writer, then "Save mine as a copy"
    const storeUrl = (p) => `${origin}${STORE}${p.split('/').map(encodeURIComponent).join('/')}`;
    const get = (p) => page.evaluate((u) => fetch(u, { cache: 'no-store' }).then(async (r) =>
      ({ status: r.status, etag: r.headers.get('etag'), text: r.status === 200 ? new TextDecoder('latin1').decode(await r.arrayBuffer()) : '' })), storeUrl(p));
    const otherWrite = async (p, body) => {
      const st = await page.evaluate((u, body) => fetch(u, { method: 'PUT', body, headers: { 'content-type': 'text/plain' } }).then((r) => r.status), storeUrl(p), body);
      if (st !== 200) throw new Error(`other writer PUT ${p}: HTTP ${st}`);
    };
    const editDoc = async (s) => {
      await page.mouse.click(650, 450); await sleep(500);
      await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control');
      await page.keyboard.type(s, { delay: 25 });
      await sleep(1000);
    };
    const expectConflict = async (p) => {
      await page.waitForSelector('#conflictDlg[open]');
      const other = await get(p);
      if (!other.text.startsWith('other writer')) throw new Error(`store item ${p} was overwritten despite the conflict: ${other.text.slice(0, 40)}`);
      const msg = await page.$eval('#conflictMsg', (e) => e.textContent);
      if (!msg.includes(p)) throw new Error(`conflict message does not name ${p}: ${msg}`);
      if (await page.$eval('#conflictReload', (e) => e.classList.contains('hidden'))) throw new Error('no "Reload theirs" choice');
      log(`conflict dialog shown, ${p} still holds the other writer's bytes`);
    };

    const dpath = `${name}.docx`;
    const otherA = `other writer A ${stamp}`;
    await otherWrite(dpath, otherA);
    await editDoc(' mine');
    expect412.add(storeUrl(dpath));
    await page.click('#btnSave');
    await expectConflict(dpath);
    await page.click('#conflictCopy');
    await page.waitForSelector('#saveDlg[open]');
    const suggested = await page.$eval('#saveName', (e) => e.value);
    if (suggested !== `${name} (copy)`) throw new Error(`copy name suggestion: ${suggested}`);
    await page.click('#saveOk');
    const cpath = `${name} (copy).docx`;
    await waitSaved(cpath);
    if ((await get(dpath)).text !== otherA) throw new Error('other writer\'s version changed after "save as copy"');
    const copy = await get(cpath);
    if (copy.status !== 200 || !copy.text.startsWith('PK') || copy.text.length < 1000) throw new Error(`copy not stored: ${copy.status} ${copy.text.length}`);
    if (await docPath() !== cpath) throw new Error(`document did not switch to the copy: ${await docPath()}`);
    log(`"Save mine as a copy" stored ${cpath} (${copy.text.length} bytes), ${dpath} kept the other writer's bytes`);

    // 6. concurrent writer on the copy, Ctrl+S, then "Overwrite"
    const otherB = `other writer B ${stamp}`;
    await otherWrite(cpath, otherB);
    await editDoc(' again');
    expect412.add(storeUrl(cpath));
    await page.keyboard.down('Control'); await page.keyboard.press('s'); await page.keyboard.up('Control');
    await expectConflict(cpath);
    await page.click('#conflictOverwrite');
    await waitSaved(cpath);
    const over = await get(cpath);
    if (!over.text.startsWith('PK') || over.text.includes(otherB)) throw new Error('overwrite did not replace the other writer\'s bytes');
    const st = await page.evaluate(() => window.office.state().doc.etag);
    if (st !== over.etag) throw new Error(`app etag ${st} != stored ${over.etag}`);
    log(`"Overwrite" replaced ${cpath} (${over.text.length} bytes), app tracks the new ETag`);
    await reopen(cpath);
    t = await text();
    if (!t.includes(' mine again')) throw new Error(`text after overwrite mismatch: ${JSON.stringify(t)}`);
    log('reopened after overwrite: text ok');

    // 7. concurrent writer puts another real document there; "Reload theirs"
    const theirs = await page.evaluate((from, to) => fetch(from).then((r) => r.arrayBuffer())
      .then((b) => fetch(to, { method: 'PUT', body: b, headers: { 'content-type': 'application/vnd.oasis.opendocument.text' } })).then((r) => r.status),
    storeUrl(file), storeUrl(cpath));
    if (theirs !== 200) throw new Error(`other writer PUT: HTTP ${theirs}`);
    await editDoc(' lost');
    expect412.add(storeUrl(cpath));
    await page.click('#btnSave');
    await page.waitForSelector('#conflictDlg[open]');
    await page.click('#conflictReload');
    await page.waitForFunction(() => !document.getElementById('conflictDlg').open && document.getElementById('loading').classList.contains('hidden')
      && /^Opened /.test(document.getElementById('status').textContent));
    await sleep(1500);
    t = await text();
    if (!t.includes(`${phrase} edited`) || t.includes('mine') || t.includes('lost')) throw new Error(`text after "Reload theirs": ${JSON.stringify(t)}`);
    const now = await get(cpath);
    if (await page.evaluate(() => window.office.state().doc.etag) !== now.etag) throw new Error('app etag after reload does not match the store');
    log('"Reload theirs" discarded mine and loaded the other writer\'s version');

    if (expect412.size) throw new Error(`expected 412 not seen for ${[...expect412].join(', ')}`);
    check('end');
    log('PASS');
    await browser.close();
  } catch (e) {
    const shot = path.join(os.tmpdir(), `office-fail-${stamp}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    console.log(`FAIL: ${e.message.split('\n')[0]}\n  screenshot: ${shot}`);
    if (errs.length) console.log('  errors:', errs.join('\n  '));
    await browser.close();
    process.exit(1);
  }
})();
