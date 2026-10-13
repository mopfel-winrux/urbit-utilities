// Enclosed satellite test: the ship owner creates an encrypted note with a
// password and burn-after-reading (stored via the %utilities hub), then an
// anonymous visitor (fresh incognito context, no cookie) opens the link,
// decrypts it, and a second visitor finds it burned.
// usage: BASE_URL=http://localhost:8206 SHIP_CODE=... CHROME=... node test.js
const puppeteer = require('/home/amadeo/Research/vert-urbit/test/node_modules/puppeteer-core');

const BASE = (process.env.BASE_URL || 'http://localhost:8206').replace(/\/$/, '');
const CODE = process.env.SHIP_CODE || 'x';
const CHROME = process.env.CHROME || `${process.env.HOME}/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome`;
const ORIGIN = new URL(BASE).origin;
const SECRET = `ship secret ${Date.now()} ✓`;
const PASSWORD = 'correct horse battery';

const errs = [];
let allowed = []; // [method, url-substring, status] of expected failures
function watch(page, label) {
  page.on('pageerror', (e) => errs.push(`${label} pageerror ${e.message}`));
  page.on('console', (m) => {
    if (process.env.VERBOSE) console.log(`  [${label} ${m.type()}] ${m.text().slice(0, 300)}`);
  });
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(ORIGIN)) errs.push(`${label} requestfailed ${r.method()} ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on('request', (r) => {
    if (!r.url().startsWith(ORIGIN) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) errs.push(`${label} external request ${r.url()}`);
  });
  page.on('response', (r) => {
    const st = r.status(), m = r.request().method(), u = r.url();
    if (st < 400 || !u.startsWith(ORIGIN)) return;
    if (allowed.some(([am, au, as]) => am === m && u.includes(au) && as === st)) return;
    errs.push(`${label} HTTP ${st} ${m} ${u}`);
  });
}
function check(cond, msg) {
  if (!cond) throw new Error(msg);
  console.log(`ok   ${msg}`);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  let failed = false;
  try {
    // --- owner: log in exactly like test/e2e.js
    const page = await browser.newPage();
    await page.setViewport({ width: 1300, height: 1000 });
    await page.goto(`${BASE}/~/login?redirect=/utilities/icon.svg`);
    await page.type('input[type=password]', CODE);
    await Promise.all([page.waitForNavigation().catch(() => {}), page.keyboard.press('Enter')]);
    watch(page, 'owner');

    await page.goto(`${BASE}/enclosed/`, { waitUntil: 'load' });
    await page.waitForSelector('[data-test-id=note-content]', { timeout: 30000 });
    await page.type('[data-test-id=note-content]', SECRET);
    await page.type('[data-test-id=note-password]', PASSWORD);
    await page.click('[data-test-id=delete-after-reading]');
    await page.click('[data-test-id=create-note]');
    await page.waitForSelector('[data-test-id=note-url]', { timeout: 30000 });
    const noteUrl = await page.$eval('[data-test-id=note-url]', (el) => el.value);
    console.log(`     note url: ${noteUrl}`);
    const m = noteUrl.match(/\/enclosed\/v\/([0-9A-Z]{26})#pw:dar:[^:]+$/);
    check(m && noteUrl.startsWith(BASE), 'note link is /enclosed/v/<id>#pw:dar:<key>');
    const id = m[1];

    const list = await page.evaluate(() => fetch('/utilities/api/store/enclosed/?prefix=notes/').then((r) => r.json()));
    const item = list.find((x) => x.path === `notes/${id}`);
    check(item && item.public && item.burn && item.expires > Date.now(), 'hub store lists the note as public, burn, with expiry');
    const stored = await page.evaluate((id) => fetch(`/utilities/api/store/enclosed/notes/${id}`).then((r) => r.text()), id);
    check(!stored.includes('ship secret') && !stored.includes(noteUrl.split('#')[1].split(':').pop()),
      'stored body holds neither the plaintext nor the key');

    // --- anonymous visitor: fresh incognito context, no cookie
    allowed = [['PUT', '/utilities/api/store/enclosed/', 401]];
    const anon = await browser.createBrowserContext();
    const v = await anon.newPage();
    watch(v, 'anon');
    await v.goto(noteUrl, { waitUntil: 'load' });
    const put2 = await v.evaluate(() => fetch('/utilities/api/store/enclosed/notes/forged', { method: 'PUT', body: 'x' }).then((r) => r.status));
    check(put2 === 401, `anonymous PUT to the store is rejected (${put2})`);
    await v.waitForSelector('[data-test-id=note-deletion-accept]', { timeout: 30000 });
    await v.click('[data-test-id=note-deletion-accept]');
    await v.waitForSelector('[data-test-id=note-password-prompt]', { timeout: 30000 });
    await v.type('[data-test-id=note-password-prompt]', PASSWORD);
    await v.click('[data-test-id=note-password-submit]');
    await v.waitForSelector('[data-test-id=note-content-display]', { timeout: 30000 });
    const text = await v.$eval('[data-test-id=note-content-display]', (el) => el.textContent.trim());
    check(text === SECRET, 'anonymous visitor decrypts the note');
    await anon.close();

    // --- second anonymous visitor: the note has burned
    allowed = [['HEAD', `/utilities/pub/enclosed/notes/${id}`, 404], ['GET', `/utilities/pub/enclosed/notes/${id}`, 404]];
    const anon2 = await browser.createBrowserContext();
    const v2 = await anon2.newPage();
    watch(v2, 'anon2');
    await v2.goto(noteUrl, { waitUntil: 'load' });
    await v2.waitForFunction(() => /not found/i.test(document.body.innerText), { timeout: 30000 });
    check(!(await v2.$('[data-test-id=note-deletion-accept]')), 'second open shows "note not found" (burned)');
    const st = await v2.evaluate((id) => fetch(`/utilities/pub/enclosed/notes/${id}`).then((r) => r.status), id);
    check(st === 404, 'public URL returns 404 after the burn');
    await anon2.close();

    allowed = [];
    const after = await page.evaluate(() => fetch('/utilities/api/store/enclosed/?prefix=notes/').then((r) => r.json()));
    check(!after.some((x) => x.path === `notes/${id}`), 'note is gone from the hub store');
  } catch (e) {
    failed = true;
    console.log(`FAIL ${e.message.split('\n')[0]}`);
  }
  await browser.close();
  if (errs.length) {
    failed = true;
    console.log('errors:\n  ' + errs.join('\n  '));
  }
  console.log(failed ? 'FAILED' : 'PASSED');
  process.exit(failed ? 1 : 0);
})();
