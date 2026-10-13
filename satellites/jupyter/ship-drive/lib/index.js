// JupyterLite default drive that keeps every file on the Urbit ship.
//
// It replaces @jupyterlite/services-extension:default-drive (IndexedDB) and
// talks WebDAV to the %utilities hub on the same origin:
//   /utilities/dav/jupyter/<path>
// PROPFIND/MKCOL/MOVE/COPY are tunneled as POST + X-HTTP-Method-Override
// (Vere only accepts standard methods; see kit/CONTRACT.md).
// The file browser, notebooks and the Pyodide kernel's /drive mount (which
// goes through the contents manager) therefore all read and write the ship.
//
// Conflicts: the hub gives every item a strong ETag (GET, PUT, PROPFIND
// getetag). The drive reports it as the model's `hash`, so JupyterLab's
// document context (which stats the file with hash:true before every save and
// compares it with the hash it loaded) shows its own "File Changed" dialog
// (Cancel / Revert / Overwrite) when someone else wrote the file. The drive
// also remembers the tag of the version it last loaded or saved per path and
// makes every PUT conditional (If-Match, or If-None-Match: * for a new file),
// so a write that races the check fails with 412 instead of overwriting.
import { PathExt } from '@jupyterlab/coreutils';
import { IDefaultDrive, ServerConnection } from '@jupyterlab/services';
import { Signal } from '@lumino/signaling';

const DAV = '/utilities/dav/jupyter/';
const STORE = '/utilities/api/store/jupyter/';
const NATIVE = { GET: 1, HEAD: 1, PUT: 1, POST: 1, DELETE: 1, OPTIONS: 1 };
const NB_MIME = 'application/x-ipynb+json';
const HASH_ALG = 'etag';

const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.py', '.csv', '.tsv', '.json', '.geojson', '.js', '.mjs',
  '.ts', '.css', '.html', '.htm', '.xml', '.svg', '.yaml', '.yml', '.toml', '.ini',
  '.cfg', '.conf', '.sh', '.r', '.jl', '.sql', '.tex', '.rst', '.log', '.c', '.h',
  '.cpp', '.hpp', '.java', '.rs', '.go', '.lua', '.hoon',
]);
const MIME = {
  '.ipynb': NB_MIME, '.py': 'text/x-python', '.md': 'text/markdown', '.csv': 'text/csv',
  '.json': 'application/json', '.txt': 'text/plain', '.html': 'text/html', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.pdf': 'application/pdf', '.js': 'application/javascript', '.css': 'text/css',
  '.xml': 'application/xml', '.yaml': 'text/yaml', '.yml': 'text/yaml', '.tsv': 'text/tab-separated-values',
};

const ext = (p) => PathExt.extname(p).toLowerCase();
const clean = (p) => (p || '').split('/').filter((s) => s && s !== '.').join('/');
const enc = (p) => clean(p).split('/').filter(Boolean).map(encodeURIComponent).join('/');
const mimeOf = (p) => MIME[ext(p)] || (TEXT_EXT.has(ext(p)) ? 'text/plain' : 'application/octet-stream');
const isText = (p, mime) =>
  TEXT_EXT.has(ext(p)) || /^text\//.test(mime || '') || /json|xml|javascript/.test(mime || '');

function httpError(res, msg) {
  return new ServerConnection.ResponseError(res, msg);
}
function conflict(res, path) {
  return httpError(res,
    `"${path}" was changed on the ship by someone else after it was loaded here, so it was not overwritten. ` +
    'Save again to choose between overwriting it with this version and reverting to the version on the ship.');
}
function notFound(path) {
  return httpError(new Response(null, { status: 404, statusText: 'Not Found' }), `Path ${path} does not exist.`);
}

function b64encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64decode(str) {
  const bin = atob(str || '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function dav(method, path, { headers = {}, body, dir = false } = {}) {
  const url = DAV + enc(path) + (dir && clean(path) ? '/' : '');
  const h = { ...headers };
  let m = method;
  if (!NATIVE[method]) {
    h['X-HTTP-Method-Override'] = method;
    m = 'POST';
  }
  return fetch(url, { method: m, headers: h, body, credentials: 'same-origin', cache: 'no-store' });
}

function parseMultistatus(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out = [];
  for (const r of doc.getElementsByTagNameNS('DAV:', 'response')) {
    const one = (n) => {
      const e = r.getElementsByTagNameNS('DAV:', n)[0];
      return e ? e.textContent : null;
    };
    let href = one('href') || '';
    try {
      href = new URL(href, location.href).pathname;
    } catch (e) {
      /* already a path */
    }
    const i = href.indexOf(DAV);
    const rel = i === -1 ? '' : href.slice(i + DAV.length);
    const path = rel.split('/').filter(Boolean).map(decodeURIComponent).join('/');
    const isDir = r.getElementsByTagNameNS('DAV:', 'collection').length > 0;
    const lm = one('getlastmodified');
    const cd = one('creationdate');
    out.push({
      path,
      isDir,
      size: parseInt(one('getcontentlength') || '0', 10),
      mime: one('getcontenttype') || '',
      modified: lm ? new Date(lm).toISOString() : new Date().toISOString(),
      created: cd ? new Date(cd).toISOString() : lm ? new Date(lm).toISOString() : new Date().toISOString(),
      etag: isDir ? null : one('getetag') || null,
    });
  }
  return out;
}

function toModel(e) {
  const name = e.path ? PathExt.basename(e.path) : '';
  if (e.isDir) {
    return {
      name, path: e.path, type: 'directory', writable: true, created: e.created,
      last_modified: e.modified, mimetype: '', content: null, format: null, size: undefined,
    };
  }
  const nb = ext(e.path) === '.ipynb';
  const mime = nb ? NB_MIME : e.mime && e.mime !== 'application/octet-stream' ? e.mime : mimeOf(e.path);
  return {
    name, path: e.path, type: nb ? 'notebook' : 'file', writable: true, created: e.created,
    last_modified: e.modified, mimetype: mime, content: null,
    format: nb ? 'json' : isText(e.path, mime) ? 'text' : 'base64', size: e.size,
  };
}

const EMPTY_NB = {
  metadata: {
    orig_nbformat: 4,
    kernelspec: { name: 'python', display_name: 'Python (Pyodide)', language: 'python' },
    language_info: { name: 'python' },
  },
  nbformat_minor: 5,
  nbformat: 4,
  cells: [],
};

export class ShipDrive {
  constructor() {
    this._fileChanged = new Signal(this);
    this._isDisposed = false;
    this._chunks = new Map();
    this._checkpoints = new Map();
    // path -> ETag of the version this browser last loaded or saved,
    // null when the path is known not to exist (absent = unknown)
    this._etags = new Map();
    this._serverSettings = ServerConnection.makeSettings();
  }
  get name() {
    return 'Ship';
  }
  get serverSettings() {
    return this._serverSettings;
  }
  get fileChanged() {
    return this._fileChanged;
  }
  get isDisposed() {
    return this._isDisposed;
  }
  dispose() {
    if (this._isDisposed) return;
    this._isDisposed = true;
    Signal.clearData(this);
  }

  async _propfind(path, depth) {
    const res = await dav('PROPFIND', path, { headers: { Depth: depth }, dir: !clean(path) });
    if (res.status === 404) return null;
    if (res.status !== 207) throw httpError(res, `PROPFIND ${path}: ${res.status}`);
    return parseMultistatus(await res.text());
  }

  // Existence checks are frequent (JupyterLab probes paths), so a single path is
  // looked up in its parent's listing: a missing file is not an HTTP 404.
  async _stat(path, depth = '0') {
    path = clean(path);
    if (!path) return this._propfind('', depth);
    const parent = PathExt.dirname(path);
    const siblings = await this._propfind(parent === '.' ? '' : parent, '1');
    const self = siblings && siblings.find((e) => e.path === path);
    if (!self) return null;
    if (depth === '0' || !self.isDir) return [self];
    return this._propfind(path, depth);
  }

  async get(localPath, options = {}) {
    const path = clean(localPath);
    const wantContent = options.content !== false && options.content !== 0;
    const entries = await this._stat(path, wantContent ? '1' : '0');
    if (!entries || !entries.length) {
      // (after a hash:true stat the context recreates a file deleted elsewhere)
      if (options.hash || !this._etags.has(path)) this._etags.set(path, null);
      throw notFound(path);
    }
    const self = entries.find((e) => e.path === path) || entries[0];
    const model = toModel(self);
    if (!wantContent) {
      if (!self.isDir) {
        // a stat with hash:true is the document context's pre/post-save check:
        // it compares the tag with the one it loaded and asks the user on a
        // mismatch, so a save that follows has been agreed to at this version
        if (options.hash || !this._etags.has(path)) this._seen(path, self.etag);
        if (options.hash && self.etag) Object.assign(model, { hash: self.etag, hash_algorithm: HASH_ALG });
      }
      return model;
    }
    if (model.type === 'directory') {
      model.content = entries.filter((e) => e.path !== path && e.path).map(toModel);
      model.format = 'json';
      return model;
    }
    const res = await dav('GET', path);
    if (res.status === 404) throw notFound(path);
    if (!res.ok) throw httpError(res, `GET ${path}: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const tag = res.headers.get('ETag');
    this._seen(path, tag);
    model.size = bytes.length;
    let format = options.format || model.format;
    if (model.type === 'notebook' && !options.format) format = 'json';
    if (format === 'json') {
      const text = new TextDecoder().decode(bytes);
      model.content = text.trim() ? JSON.parse(text) : model.type === 'notebook' ? EMPTY_NB : null;
    } else if (format === 'text') {
      model.content = new TextDecoder().decode(bytes);
    } else {
      model.content = b64encode(bytes);
      format = 'base64';
    }
    model.format = format;
    if (options.hash && tag) Object.assign(model, { hash: tag, hash_algorithm: HASH_ALG });
    return model;
  }

  async getDownloadUrl(localPath) {
    return STORE + enc(localPath);
  }

  async _names(dir) {
    const entries = (await this._stat(dir, '1')) || [];
    return new Set(entries.filter((e) => e.path !== clean(dir)).map((e) => PathExt.basename(e.path)));
  }

  // a free name in dir; it is recorded as absent, so saving it creates
  // (If-None-Match: *) and can't clobber a file someone made meanwhile
  async _unique(dir, stem, suffix, first) {
    const names = await this._names(dir);
    let n = first;
    for (let i = first ? 1 : 0; !n || names.has(n); i++) n = `${stem}${i || ''}${suffix}`;
    this._etags.set(clean(PathExt.join(dir, n)), null);
    return n;
  }

  async newUntitled(options = {}) {
    const dir = clean(options.path);
    const type = options.type || 'notebook';
    let model;
    if (type === 'directory') {
      const name = await this._unique(dir, 'Untitled Folder', '');
      model = await this.save(PathExt.join(dir, name), { type: 'directory' });
    } else if (type === 'notebook') {
      const name = await this._unique(dir, 'Untitled', '.ipynb');
      model = await this.save(PathExt.join(dir, name), { type: 'notebook', format: 'json', content: EMPTY_NB });
    } else {
      let e = options.ext || '.txt';
      if (!e.startsWith('.')) e = '.' + e;
      const name = await this._unique(dir, 'untitled', e);
      model = await this.save(PathExt.join(dir, name), { type: 'file', format: 'text', content: '' });
    }
    this._fileChanged.emit({ type: 'new', oldValue: null, newValue: model });
    return model;
  }

  // conditional on what this browser last saw of the path (unconditional
  // when it has never seen it, e.g. a kernel write to a fresh path)
  async _put(path, bytes, mime, { force = false } = {}) {
    const headers = { 'Content-Type': mime };
    const known = this._etags.get(path);
    if (!force && known) headers['If-Match'] = known;
    else if (!force && known === null) headers['If-None-Match'] = '*';
    const res = await dav('PUT', path, { headers, body: bytes });
    if (res.status === 412) throw conflict(res, path);
    if (!res.ok) throw httpError(res, `PUT ${path}: ${res.status}`);
    this._seen(path, res.headers.get('ETag'));
  }

  async save(localPath, options = {}) {
    const path = clean(localPath);
    if (!path) throw new Error('cannot save the root directory');
    if (options.type === 'directory') {
      const res = await dav('MKCOL', path, { dir: true });
      if (!(res.ok || res.status === 405)) throw httpError(res, `MKCOL ${path}: ${res.status}`);
    } else {
      const nb = options.type === 'notebook' || ext(path) === '.ipynb';
      const mime = nb ? NB_MIME : options.mimetype || mimeOf(path);
      let bytes;
      const c = options.content;
      if (c === undefined || c === null) bytes = new Uint8Array(0);
      else if (options.format === 'json' || (typeof c === 'object' && !options.format))
        bytes = new TextEncoder().encode(JSON.stringify(c, null, 1) + '\n');
      else if (options.format === 'base64') bytes = b64decode(c);
      else bytes = new TextEncoder().encode(String(c));
      const chunk = options.chunk;
      if (chunk) {
        // chunked upload from the file browser: 1, 2, ..., -1 (last)
        const parts = chunk === 1 ? [] : this._chunks.get(path) || [];
        parts.push(bytes);
        if (chunk !== -1) {
          this._chunks.set(path, parts);
          return { ...toModel({ path, isDir: false, size: 0, mime, modified: new Date().toISOString(), created: new Date().toISOString() }) };
        }
        this._chunks.delete(path);
        bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
      }
      await this._put(path, bytes, mime);
    }
    const st = await this._stat(path, '0');
    if (!st || !st.length) throw notFound(path);
    const model = toModel(st[0]);
    const tag = this._etags.get(path);
    if (tag) Object.assign(model, { hash: tag, hash_algorithm: HASH_ALG });
    this._fileChanged.emit({ type: 'save', oldValue: null, newValue: model });
    return model;
  }

  // the version of path we now hold (no tag from the server: unknown)
  _seen(path, tag) {
    if (tag) this._etags.set(path, tag);
    else this._etags.delete(path);
  }

  // drop what we knew about path and everything under it; then path is
  // known absent (null) or unknown (undefined)
  _forget(path, v) {
    for (const p of [...this._etags.keys()]) if (p.startsWith(path + '/')) this._etags.delete(p);
    if (v === undefined) this._etags.delete(path);
    else this._etags.set(path, v);
  }

  async delete(localPath) {
    const path = clean(localPath);
    const res = await dav('DELETE', path);
    if (!(res.ok || res.status === 404)) throw httpError(res, `DELETE ${path}: ${res.status}`);
    this._checkpoints.delete(path);
    this._forget(path, null);
    this._fileChanged.emit({ type: 'delete', oldValue: { path }, newValue: null });
  }

  async rename(oldLocalPath, newLocalPath) {
    const from = clean(oldLocalPath), to = clean(newLocalPath);
    const kind = await this._stat(from, '0');
    if (!kind) throw notFound(from);
    const res = await dav('MOVE', from, {
      dir: kind[0].isDir,
      headers: { Destination: DAV + enc(to) + (kind[0].isDir ? '/' : ''), Overwrite: 'F' },
    });
    if (res.status === 412) throw httpError(res, `File ${to} already exists.`);
    if (!res.ok) throw httpError(res, `MOVE ${from}: ${res.status}`);
    // the moved items keep their content, so what we knew about them moves too
    for (const [p, tag] of [...this._etags]) {
      if (p === from || p.startsWith(from + '/')) {
        this._etags.delete(p);
        this._etags.set(to + p.slice(from.length), tag);
      }
    }
    this._etags.set(from, null);
    const model = await this.get(to, { content: false });
    this._fileChanged.emit({ type: 'rename', oldValue: { path: from }, newValue: model });
    return model;
  }

  async copy(localPath, toLocalDir) {
    const path = clean(localPath), dir = clean(toLocalDir);
    const base = PathExt.basename(path);
    const e = PathExt.extname(base);
    const stem = base.slice(0, base.length - e.length);
    const name = await this._unique(dir, `${stem}-Copy`, e);
    const to = PathExt.join(dir, name);
    const st = await this._stat(path, '0');
    if (!st) throw notFound(path);
    const res = await dav('COPY', path, {
      dir: st[0].isDir,
      headers: { Destination: DAV + enc(to) + (st[0].isDir ? '/' : ''), Overwrite: 'F' },
    });
    if (res.status === 412) throw httpError(res, `File ${to} already exists.`);
    if (!res.ok) throw httpError(res, `COPY ${path}: ${res.status}`);
    this._forget(to, undefined);
    const model = await this.get(to, { content: false });
    this._fileChanged.emit({ type: 'new', oldValue: null, newValue: model });
    return model;
  }

  // Checkpoints live in memory for this browser session only.
  async createCheckpoint(localPath) {
    const path = clean(localPath);
    const res = await dav('GET', path);
    const data = res.ok ? await res.arrayBuffer() : new ArrayBuffer(0);
    const cp = { id: 'checkpoint', last_modified: new Date().toISOString() };
    this._checkpoints.set(path, { cp, data });
    return cp;
  }
  async listCheckpoints(localPath) {
    const c = this._checkpoints.get(clean(localPath));
    return c ? [c.cp] : [];
  }
  async restoreCheckpoint(localPath, checkpointID) {
    const path = clean(localPath);
    const c = this._checkpoints.get(path);
    if (!c) throw notFound(path);
    // an explicit "revert to checkpoint": the user asked for this version
    await this._put(path, c.data, ext(path) === '.ipynb' ? NB_MIME : mimeOf(path), { force: true });
  }
  async deleteCheckpoint(localPath, checkpointID) {
    this._checkpoints.delete(clean(localPath));
  }
}

const plugin = {
  id: 'jupyterlite-ship-drive:default-drive',
  description: 'Default contents drive stored on the Urbit ship (%utilities WebDAV).',
  autoStart: true,
  provides: IDefaultDrive,
  activate: () => new ShipDrive(),
};

export default [plugin];
