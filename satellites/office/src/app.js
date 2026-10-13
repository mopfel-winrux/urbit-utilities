// SPDX-License-Identifier: MIT
// Office satellite: ZetaOffice (LibreOffice wasm) with documents on the ship.
// Storage: the %utilities hub store, same origin:
//   GET    /utilities/api/store/office/          list
//   GET    /utilities/api/store/office/<path>    open
//   PUT    /utilities/api/store/office/<path>    save (conditional, see upload)
//   DELETE /utilities/api/store/office/<path>    delete
'use strict';

const STORE = '/utilities/api/store/office/';
const DOC_EXT = ['odt', 'ods', 'odp', 'odg', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'rtf', 'txt', 'csv', 'pdf'];
const MIME = {
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  odg: 'application/vnd.oasis.opendocument.graphics',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  rtf: 'application/rtf', txt: 'text/plain', csv: 'text/csv', html: 'text/html', pdf: 'application/pdf',
};
const DEFAULT_EXT = {writer: 'odt', calc: 'ods', impress: 'odp', draw: 'odg'};
const NEW_NAME = {writer: 'Untitled document', calc: 'Untitled spreadsheet', impress: 'Untitled presentation'};

const $ = (s) => document.querySelector(s);
const canvas = $('#qtcanvas');
const state = {thr: null, ready: false, doc: null, filters: {}, seq: 0, pending: new Map(), busy: false};
// doc = {kind, path (ship path or null), name, local (FS path), ext,
//        etag (ETag of the ship version this copy is based on, or null)}

function status(msg) { $('#status').textContent = msg || ''; }
function showLoading(msg) { $('#loadmsg').textContent = msg; $('#loading').classList.remove('hidden'); }
function hideLoading() { $('#loading').classList.add('hidden'); }
const extOf = (n) => (n.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
const baseOf = (p) => p.split('/').pop();
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

function call(cmd, args = {}) {
  const id = ++state.seq;
  return new Promise((resolve, reject) => {
    state.pending.set(id, {resolve, reject});
    state.thr.postMessage({cmd, id, ...args});
  });
}

function onThread(e) {
  const m = e.data;
  if (m.cmd === 'reply') {
    const p = state.pending.get(m.id);
    state.pending.delete(m.id);
    if (p) (m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)));
  } else if (m.cmd === 'ready') {
    onReady();
  } else if (m.cmd === 'lo_cmd') {
    // LibreOffice's own Save / Save As / Open / Print / New commands
    if (state.busy) return;
    const run = {save, saveas: saveAs, pdf: exportPdf, home: showHome, new: () => newDoc(m.kind)}[m.action];
    if (run) run();
  }
}

function ensureDir(d) {
  const parts = d.split('/').filter(Boolean);
  let cur = '';
  for (const p of parts) {
    cur += '/' + p;
    try { FS.mkdir(cur); } catch (e) { /* exists */ }
  }
}

let localSeq = 0;
function localPath(name) {
  const dir = `/tmp/office/${Date.now().toString(36)}-${++localSeq}`;
  ensureDir(dir);
  return `${dir}/${name.replace(/[\/\\]/g, '_')}`;
}

// ---- ship store --------------------------------------------------------
async function listFiles() {
  const res = await fetch(STORE, {credentials: 'same-origin'});
  if (!res.ok) throw new Error(`store list: HTTP ${res.status}`);
  const rows = await res.json();
  return rows.filter((r) => DOC_EXT.includes(extOf(r.path))).sort((a, b) => b.modified - a.modified);
}

async function renderFiles() {
  const tb = $('#files tbody');
  let rows;
  try { rows = await listFiles(); } catch (e) {
    tb.innerHTML = `<tr><td class="empty">Could not reach the ship's store (${e.message}).</td></tr>`;
    return;
  }
  if (!rows.length) {
    tb.innerHTML = '<tr><td class="empty">No documents yet. Create one above, or open one from your computer.</td></tr>';
    return;
  }
  tb.innerHTML = '<tr><th>Name</th><th>Modified</th><th>Size</th><th></th></tr>';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.dataset.path = r.path;
    const kb = r.size < 1024 * 1024 ? `${Math.max(1, Math.round(r.size / 1024))} KB` : `${(r.size / 1048576).toFixed(1)} MB`;
    tr.innerHTML = `<td class="name"><a href="#"></a></td><td>${new Date(r.modified).toLocaleString()}</td><td>${kb}</td>`
      + '<td class="act"><button data-act="dl">Download</button> <button data-act="rm">Delete</button></td>';
    tr.querySelector('a').textContent = r.path;
    tr.querySelector('a').onclick = (ev) => { ev.preventDefault(); openFromShip(r.path); };
    tr.querySelector('[data-act=dl]').onclick = async () => {
      const res = await fetch(STORE + enc(r.path), {credentials: 'same-origin'});
      if (res.ok) downloadBlob(await res.blob(), baseOf(r.path));
    };
    tr.querySelector('[data-act=rm]').onclick = async () => {
      if (!confirm(`Delete ${r.path} from your ship?`)) return;
      await fetch(STORE + enc(r.path), {method: 'DELETE', credentials: 'same-origin'});
      renderFiles();
    };
    tb.appendChild(tr);
  }
}

// The ETag of what is on the ship now (null if nothing is), for "Overwrite".
async function currentEtag(path) {
  const res = await fetch(STORE + enc(path), {method: 'HEAD', credentials: 'same-origin', cache: 'no-store'});
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`could not check ${path}: HTTP ${res.status}`);
  return res.headers.get('etag');
}

// Conditional PUT: `etag` is the version we expect to replace (If-Match), or
// null for "create only" (If-None-Match: *). Returns the new ETag, or
// CONFLICT when the store answers 412 (someone else's version is there).
const CONFLICT = Symbol('conflict');
async function upload(path, local, etag) {
  const bytes = FS.readFile(local);
  status('Saving to ship…');
  const headers = {'content-type': MIME[extOf(path)] || 'application/octet-stream'};
  if (etag) headers['if-match'] = etag; else headers['if-none-match'] = '*';
  const res = await fetch(STORE + enc(path), {method: 'PUT', credentials: 'same-origin', body: bytes, headers});
  if (res.status === 412) { status(`Not saved (conflict with ${path} on your ship)`); return CONFLICT; }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  status(`Saved ${path} to your ship`);
  return res.headers.get('etag');
}

// ---- documents -----------------------------------------------------------
async function confirmDiscard() {
  if (!state.doc) return true;
  const modified = await call('modified').catch(() => false);
  return !modified || confirm('Discard unsaved changes to the current document?');
}

function showDoc(doc) {
  state.doc = doc;
  $('#docname').textContent = doc.path ? doc.path : `${doc.name} (not saved)`;
  document.title = `${doc.path ? baseOf(doc.path) : doc.name} - Office`;
  $('#home').classList.add('hidden');
  canvas.style.visibility = 'visible';
  for (const b of ['#btnSave', '#btnSaveAs', '#btnExport']) $(b).disabled = false;
  // Qt picks up the canvas size on resize
  setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  setTimeout(() => { window.dispatchEvent(new Event('resize')); canvas.focus(); }, 800);
}

function showHome() {
  $('#home').classList.remove('hidden');
  canvas.style.visibility = 'hidden';
  renderFiles();
}

async function withBusy(msg, fn) {
  state.busy = true;
  showLoading(msg);
  try { return await fn(); } catch (e) {
    status('Error: ' + e.message);
    alert(e.message);
  } finally { state.busy = false; hideLoading(); }
}

async function openBytes(bytes, name, path, etag = null) {
  const local = localPath(name);
  FS.writeFile(local, new Uint8Array(bytes));
  const {kind} = await call('open', {path: local});
  showDoc({kind, path, name, local, ext: extOf(name), etag});
}

async function openFromShip(path, {discard = false} = {}) {
  if (!discard && !await confirmDiscard()) return;
  await withBusy(`Opening ${path}…`, async () => {
    const res = await fetch(STORE + enc(path), {credentials: 'same-origin', cache: 'no-store'});
    if (!res.ok) throw new Error(`could not fetch ${path}: HTTP ${res.status}`);
    await openBytes(await res.arrayBuffer(), baseOf(path), path, res.headers.get('etag'));
    status(`Opened ${path}`);
  });
}

async function newDoc(kind) {
  if (!await confirmDiscard()) return;
  await withBusy('Creating document…', async () => {
    const r = await call('new', {kind});
    const ext = DEFAULT_EXT[r.kind] || 'odt';
    showDoc({kind: r.kind, path: null, name: `${NEW_NAME[r.kind] || 'Untitled'}.${ext}`, local: null, ext, etag: null});
    status('');
  });
}

async function importLocal(file) {
  if (!await confirmDiscard()) return;
  await withBusy(`Opening ${file.name}…`, async () => {
    await openBytes(await file.arrayBuffer(), file.name, null);
    status(`Opened ${file.name} from this computer. Save puts it on your ship.`);
  });
}

function formatsFor(kind) {
  return (state.filters[kind] || ['odt']);
}

function askSaveAs(doc, suggest) {
  return new Promise((resolve) => {
    const dlg = $('#saveDlg');
    const fmts = formatsFor(doc.kind);
    let ext = extOf(suggest || doc.path || doc.name);
    if (!fmts.includes(ext)) ext = DEFAULT_EXT[doc.kind] || fmts[0];
    const base = (suggest || doc.path || doc.name).replace(/\.[a-z0-9]+$/i, '');
    $('#saveName').value = base;
    $('#saveFmt').innerHTML = fmts.map((f) => `<option value="${f}"${f === ext ? ' selected' : ''}>.${f}</option>`).join('');
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return resolve(null);
      const name = $('#saveName').value.trim().replace(/^\/+/, '').replace(/\.[a-z0-9]+$/i, '');
      resolve(name ? `${name}.${$('#saveFmt').value}` : null);
    };
    dlg.returnValue = '';
    dlg.showModal();
    $('#saveName').select();
  });
}

// Save the current document to `path` on the ship, never overwriting someone
// else's version silently: the document's own path is saved with If-Match
// (the ETag we opened or last saved), any other path is create-only. With
// `overwrite`, the version now on the ship is replaced on purpose (If-Match
// with its current ETag). Returns CONFLICT on 412, else nothing.
async function saveTo(path, {overwrite = false} = {}) {
  const doc = state.doc;
  const ext = extOf(path);
  const local = localPath(baseOf(path));
  await call('store', {path: local, ext});
  let etag;
  try {
    const expect = overwrite ? await currentEtag(path) : (path === doc.path ? doc.etag : null);
    etag = await upload(path, local, expect);
  } catch (e) {
    if (ext !== 'pdf') await call('setModified', {value: true}).catch(() => {});
    throw e;
  }
  if (etag === CONFLICT) {
    // storeToURL cleared the modified flag, but nothing was saved
    if (ext !== 'pdf') await call('setModified', {value: true}).catch(() => {});
    return CONFLICT;
  }
  if (ext !== 'pdf') {
    // subsequent saves (and LibreOffice's own Ctrl+S) target this file
    doc.path = path; doc.name = baseOf(path); doc.ext = ext; doc.local = local; doc.etag = etag;
    showDoc(doc);
  }
}

// "<path> changed on the ship" / "<path> already exists": ask what to do.
// Resolves to 'overwrite', 'copy', 'reload' or null (cancel).
function askConflict(path) {
  return new Promise((resolve) => {
    const dlg = $('#conflictDlg');
    const mine = state.doc && path === state.doc.path;
    $('#conflictTitle').textContent = mine ? 'Changed on your ship' : 'File already exists';
    $('#conflictMsg').textContent = mine
      ? `${path} was changed on your ship (from another tab, device or app) after you opened it. Your changes have not been saved.`
      : `${path} already exists on your ship. Your document has not been saved.`;
    // reloading only makes sense for the file this document came from
    $('#conflictReload').classList.toggle('hidden', !mine);
    dlg.onclose = () => resolve(['overwrite', 'copy', 'reload'].includes(dlg.returnValue) ? dlg.returnValue : null);
    dlg.returnValue = '';
    dlg.showModal();
    $('#conflictCopy').focus();
  });
}

function copyName(path) {
  const m = path.match(/^(.*?)(\.[a-z0-9]+)?$/i);
  return `${m[1]} (copy)${m[2] || ''}`;
}

async function saveFlow(path) {
  let overwrite = false;
  for (;;) {
    const r = await withBusy('Saving…', () => saveTo(path, {overwrite}));
    if (r !== CONFLICT) return;
    const choice = await askConflict(path);
    if (choice === 'overwrite') { overwrite = true; continue; }
    overwrite = false;
    if (choice === 'copy') {
      const p = await askSaveAs(state.doc, copyName(path));
      if (p) { path = p; continue; }
    } else if (choice === 'reload') {
      return openFromShip(path, {discard: true});
    }
    status(`Not saved (conflict with ${path} on your ship)`);
    return;
  }
}

async function save() {
  if (!state.doc) return;
  const doc = state.doc;
  if (!doc.path || !formatsFor(doc.kind).includes(extOf(doc.path))) return saveAs();
  await saveFlow(doc.path);
}

async function saveAs() {
  if (!state.doc) return;
  const path = await askSaveAs(state.doc);
  if (!path) return;
  await saveFlow(path);
}

async function exportPdf() {
  const doc = state.doc;
  if (!doc) return;
  await withBusy('Exporting PDF…', async () => {
    const name = (doc.path ? baseOf(doc.path) : doc.name).replace(/\.[a-z0-9]+$/i, '') + '.pdf';
    const local = localPath(name);
    await call('store', {path: local, ext: 'pdf'});
    downloadBlob(new Blob([FS.readFile(local)], {type: MIME.pdf}), name);
  });
}

async function exportLocal() {
  const doc = state.doc;
  if (!doc) return;
  await withBusy('Exporting…', async () => {
    const name = doc.path ? baseOf(doc.path) : doc.name;
    const ext = formatsFor(doc.kind).includes(extOf(name)) ? extOf(name) : DEFAULT_EXT[doc.kind];
    const local = localPath(name.replace(/\.[a-z0-9]+$/i, '') + '.' + ext);
    await call('store', {path: local, ext});
    downloadBlob(new Blob([FS.readFile(local)], {type: MIME[ext]}), baseOf(local));
  });
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---- boot ----------------------------------------------------------------
async function onReady() {
  state.filters = await call('filters');
  state.ready = true;
  hideLoading();
  for (const b of document.querySelectorAll('[data-new], #btnImport')) b.disabled = false;
  status('Ready');
  window.officeReady = true;
}

function wire() {
  $('#btnHome').onclick = showHome;
  $('#btnSave').onclick = save;
  $('#btnSaveAs').onclick = saveAs;
  $('#btnExport').onclick = exportLocal;
  for (const b of document.querySelectorAll('[data-new]')) b.onclick = () => newDoc(b.dataset.new);
  $('#btnImport').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importLocal(f); };
  canvas.addEventListener('wheel', (e) => e.preventDefault(), {passive: false});
  let dpr = window.devicePixelRatio;
  window.addEventListener('resize', () => {
    // tell Qt about browser zoom changes
    if (dpr !== window.devicePixelRatio) { dpr = window.devicePixelRatio; setTimeout(() => window.dispatchEvent(new Event('resize')), 100); }
  });
}

function boot() {
  wire();
  renderFiles();
  showLoading('Loading LibreOffice (first visit downloads ~80 MB)…');
  window.Module = {
    canvas,
    uno_scripts: ['./zeta.js', './office_thread.js'],
    locateFile: (path, prefix) => (prefix || '') + path,
  };
  const s = document.createElement('script');
  s.src = 'soffice.js';
  s.onload = () => Module.uno_main.then((port) => { state.thr = port; port.onmessage = onThread; });
  s.onerror = () => { $('#fatal').textContent = 'Could not load soffice.js'; };
  document.body.appendChild(s);
}

// test/debug hooks
window.office = {
  call: (cmd, args) => call(cmd, args),
  text: () => call('text'),
  state: () => ({ready: state.ready, doc: state.doc && {...state.doc}}),
  openFromShip, newDoc, saveTo, save, saveAs,
};

window.OFFICE_BOOT.then(boot, () => {});
