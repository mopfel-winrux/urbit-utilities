#!/usr/bin/env python3
"""Mock Urbit ship for developing %utilities satellites (see kit/CONTRACT.md).

usage: python3 kit/serve.py [--port 8200] [--publisher ~nus]

- serves satellites/<desk>/desk/web at /<desk>/ and hub/desk/web at /utilities/
  with the kit fileserver's semantics (extension %fall, spa, auth, raw bytes)
- implements the hub API: /utilities/api, /utilities/pub, /utilities/dav
- login like a ship: /~/login form, any password, cookie urbauth-~nus
State is in memory and is lost on restart.
"""
import argparse, email.utils, hashlib, html, json, os, re, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, unquote, urlsplit, parse_qs

KIT = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(KIT)
sys.path.insert(0, KIT)
from marks import MIME  # noqa: E402
from claysafe import enc  # noqa: E402

COOKIE = 'urbauth-~nus=0vmock'
LOCK = threading.Lock()
STORE = {}   # (app, path) -> dict(data, type, modified, public, burn, expires, dir)
INSTALLING = {}
DAV_METHODS = {'PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK'}


def now_ms():
    return int(time.time() * 1000)


def desk_dirs():
    out = {}
    sat = os.path.join(ROOT, 'satellites')
    for d in sorted(os.listdir(sat)) if os.path.isdir(sat) else []:
        if os.path.isdir(os.path.join(sat, d, 'desk', 'web')):
            out[d] = os.path.join(sat, d, 'desk')
    hub = os.path.join(ROOT, 'hub', 'desk')
    if os.path.isdir(os.path.join(hub, 'web')):
        out['utilities'] = hub
    return out


def desk_config(desk_dir):
    """Read spa and auth from app/fileserver/config.hoon (simple forms only)."""
    try:
        src = open(os.path.join(desk_dir, 'app', 'fileserver', 'config.hoon')).read()
    except OSError:
        return {'spa': False, 'auth': True, 'public': []}
    spa = bool(re.search(r'\+\+\s+spa\s+\^-\s+\?\s+&', src))
    for arm in ('spa', 'auth'):
        line = re.search(r'^\+\+\s+' + arm + r'\s.*$', src, re.M)
        if line and not re.search(r'\s([&|]|\[.*\])\s*$', line.group(0)):
            raise SystemExit(f'bad {arm} in {desk_dir}/app/fileserver/config.hoon: {line.group(0)!r}')
    # value after the type: `^-  ?  <v>` or `^-  $@(? [? (list [path ?])])  <v>`
    m = re.search(r'^\+\+\s+auth\s+\^-\s+(?:\?|\$@\(\? \[\? \(list \[path \?\]\)\]\))\s+(.+?)\s*$', src, re.M)
    auth, public = True, []
    if m:
        v = m.group(1).strip()
        if v == '|':
            auth = False
        elif v.startswith('['):
            auth = v[1] == '&'
            public = [p for p, f in re.findall(r'\[(/[^\s\]]*)\s+([&|])\]', v) if f == '|']
    return {'spa': spa, 'auth': auth, 'public': public}


def catalog(publisher):
    path = os.path.join(ROOT, 'catalog.json')
    apps = json.load(open(path)) if os.path.exists(path) else []
    desks = desk_dirs()
    out = []
    for a in apps:
        d = a['desk']
        status = 'installed' if d in desks else 'available'
        if INSTALLING.get(d) and status != 'installed':
            status = 'installing'
        out.append({**a, 'href': f'/{d}/', 'status': status})
    return {'publisher': publisher, 'apps': out}


def rfc1123(ms):
    return email.utils.formatdate(ms / 1000, usegmt=True)


def iso(ms):
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(ms / 1000))


def etag(item):
    return '"%s"' % hashlib.sha1(item['data']).hexdigest()[:16]


def etag_in(val, tag):
    """Does an If-Match/If-None-Match list name tag? '*' matches anything."""
    for t in val.split(','):
        t = t.strip()
        if t.startswith('W/'):
            t = t[2:]
        if t == '*' or t == tag:
            return True
    return False


def precondition(headers, it):
    """If-Match / If-None-Match for a write against the live item (or None)."""
    tag = etag(it) if it and not it['dir'] and alive(it) else None
    im, inm = headers.get('If-Match'), headers.get('If-None-Match')
    if im is not None and (tag is None or not etag_in(im, tag)):
        return False
    if inm is not None and tag is not None and etag_in(inm, tag):
        return False
    return True


def parse_range(val, n):
    """One bytes= range: None = serve everything, () = 416, (a, b) inclusive."""
    if not val or not val.startswith('bytes='):
        return None
    spec = val[6:].strip()
    if ',' in spec or spec.count('-') != 1:
        return None
    lo, hi = (x.strip() for x in spec.split('-'))
    if lo == '':
        if not hi.isdigit():
            return None
        return () if int(hi) == 0 or n == 0 else (n - min(n, int(hi)), n - 1)
    if not lo.isdigit() or (hi and not hi.isdigit()):
        return None
    if hi and int(hi) < int(lo):
        return None
    if int(lo) >= n:
        return ()
    return (int(lo), min(n - 1, int(hi) if hi else n - 1))


def alive(item):
    return item['expires'] is None or item['expires'] > now_ms()


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'mock-urbit'

    def log_message(self, fmt, *args):
        if self.server.verbose:
            sys.stderr.write('%s %s\n' % (self.command, self.path))

    # -- helpers ----------------------------------------------------------
    def authed(self):
        return COOKIE.split('=')[0] + '=' in (self.headers.get('Cookie') or '')

    def body(self):
        # read once and keep it: an early answer (401, 412...) must still drain
        # the body, or the next request on this keep-alive connection is garbage
        if not hasattr(self, '_body'):
            n = int(self.headers.get('Content-Length') or 0)
            self._body = self.rfile.read(n) if n else b''
        return self._body

    def send(self, code, data=b'', ctype='text/plain', headers=None):
        if isinstance(data, str):
            data = data.encode()
        self.send_response(code)
        if code not in (204, 304):
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD' and code not in (204, 304):
            self.wfile.write(data)

    def serve(self, it, extra=None):
        """GET/HEAD of a stored item: single Range (206/416), else If-None-Match (304)."""
        extra = dict(extra or {})
        data, n = it['data'], len(it['data'])
        rng = parse_range(self.headers.get('Range'), n)
        if rng is None:
            tag = etag(it)
            inm = self.headers.get('If-None-Match')
            if inm is not None and etag_in(inm, tag):
                return self.send(304, headers={'ETag': tag, **extra})
            return self.send(200, data, it['type'], {'ETag': tag, 'Accept-Ranges': 'bytes', **extra})
        if rng == ():
            return self.send(416, headers={'Content-Range': f'bytes */{n}', **extra})
        a, b = rng
        return self.send(206, data[a:b + 1], it['type'],
                         {'Content-Range': f'bytes {a}-{b}/{n}', 'Accept-Ranges': 'bytes', **extra})

    def json(self, code, obj):
        self.send(code, json.dumps(obj), 'application/json')

    # -- dispatch ---------------------------------------------------------
    def handle_any(self):
        # one handler serves a whole keep-alive connection: forget the last
        # request's body, then always drain this one's (see body())
        self.__dict__.pop('_body', None)
        self.body()
        url = urlsplit(self.path)
        p = url.path
        if p == '/~/login':
            return self.login()
        if p.startswith('/utilities/api/') or p == '/utilities/api':
            return self.api(p[len('/utilities/api'):], url.query)
        if p.startswith('/utilities/pub/'):
            return self.pub(p[len('/utilities/pub/'):])
        if p.startswith('/utilities/dav/'):
            return self.dav(p[len('/utilities/dav/'):])
        return self.static(p)

    do_GET = do_HEAD = do_PUT = do_POST = do_DELETE = do_OPTIONS = handle_any

    def do_PATCH(self):  # vere rejects anything non-standard
        self.__dict__.pop('_body', None)
        self.body()
        self.send(400, 'bad method')
    do_PROPFIND = do_MKCOL = do_MOVE = do_COPY = do_LOCK = do_UNLOCK = do_PROPPATCH = do_PATCH

    def login(self):
        if self.command == 'POST':
            self.body()
            redirect = parse_qs(urlsplit(self.path).query).get('redirect', ['/utilities/'])[0]
            return self.send(303, '', headers={'Location': redirect,
                                               'Set-Cookie': COOKIE + '; Path=/; Max-Age=2592000'})
        form = ('<html><body><form method="post"><input type="password" name="password">'
                '<button type="submit">login</button></form></body></html>')
        self.send(200, form, 'text/html')

    # -- static (kit fileserver semantics) ---------------------------------
    def static(self, path):
        segs = path.split('/')[1:]
        desks = desk_dirs()
        if not segs or segs[0] not in desks:
            return self.send(404, 'not found')
        if self.command not in ('GET', 'HEAD'):
            return self.send(405, 'read-only resource')
        desk = segs[0]
        cfg = desk_config(desks[desk])
        # the fileserver matches auth paths on segments without the extension
        rest = '/' + '/'.join(segs[1:])
        if '.' in rest.rsplit('/', 1)[-1]:
            rest = rest.rsplit('.', 1)[0]
        need_auth = cfg['auth'] and not any(rest == pp or rest.startswith(pp + '/') for pp in cfg['public'])
        if need_auth and not self.authed():
            return self.send(403, 'unauthorized')
        web = os.path.join(desks[desk], 'web')
        rel = [unquote(s) for s in segs[1:]]
        if not rel:
            rel = ['']
        last = rel[-1]
        # same clay-safe encoding as the fileserver's +enc
        if last == '':
            target = [enc(x) for x in rel[:-1]] + ['index.html']
        elif '.' in last:
            base, ext = last.rsplit('.', 1)
            target = [enc(x) for x in rel[:-1]] + [enc(base) + '.' + enc(ext.lower())]
        else:
            target = [enc(x) for x in rel] + ['index.html']
        fpath = os.path.join(web, *target)
        if not os.path.isfile(fpath) and cfg['spa'] and '.' not in last:
            fpath = os.path.join(web, 'index.html')
        if not os.path.isfile(fpath) or '..' in rel:
            return self.send(404, 'not found')
        ext = fpath.rsplit('.', 1)[1]
        self.send(200, open(fpath, 'rb').read(), MIME.get(ext, 'application/octet-stream'))

    # -- api -------------------------------------------------------------
    def api(self, sub, query):
        if not self.authed():
            return self.json(401, {'error': 'unauthorized'})
        if sub == '/catalog' and self.command == 'GET':
            return self.json(200, catalog(self.server.publisher))
        if sub == '/publisher' and self.command == 'POST':
            try:
                ship = json.loads(self.body() or b'{}').get('ship')
            except ValueError:
                return self.json(400, {'error': 'bad body'})
            if ship is None:
                self.server.publisher = self.server.default_publisher
            elif isinstance(ship, str) and re.match(r'^~[a-z-]+$', ship):
                self.server.publisher = ship
            else:
                return self.json(400, {'error': 'bad ship'})
            return self.json(200, {'publisher': self.server.publisher})
        if sub in ('/install', '/uninstall') and self.command == 'POST':
            try:
                desk = json.loads(self.body() or b'{}').get('desk')
            except ValueError:
                desk = None
            if not isinstance(desk, str) or not re.match(r'^[a-z][a-z0-9-]*$', desk):
                return self.json(400, {'error': 'bad desk'})
            if desk not in [a['desk'] for a in catalog(self.server.publisher)['apps']]:
                return self.json(400, {'error': 'not in catalog'})
            if sub == '/install':
                INSTALLING[desk] = True
            else:
                INSTALLING.pop(desk, None)
            return self.json(202, {'ok': True})
        if sub == '/store/' and self.command == 'GET':
            with LOCK:
                apps = {}
                for (a, p), it in STORE.items():
                    if not it['dir'] and alive(it):
                        c = apps.setdefault(a, {'app': a, 'count': 0, 'size': 0})
                        c['count'] += 1
                        c['size'] += len(it['data'])
            return self.json(200, [apps[a] for a in sorted(apps)])
        m = re.match(r'^/store/([a-z0-9-]+)/(.*)$', sub)
        if not m:
            return self.json(404, {'error': 'not found'})
        app, rest = m.group(1), m.group(2)
        path = '/'.join(unquote(s) for s in rest.split('/') if s)
        with LOCK:
            if path == '' and self.command == 'GET':
                prefix = parse_qs(query).get('prefix', [''])[0]
                rows = [{'path': p, 'type': it['type'], 'size': len(it['data']),
                         'modified': it['modified'], 'public': it['public'],
                         'burn': it['burn'], 'expires': it['expires']}
                        for (a, p), it in sorted(STORE.items())
                        if a == app and not it['dir'] and alive(it) and p.startswith(prefix)]
                return self.json(200, rows)
            if not path:
                return self.json(400, {'error': 'path required'})
            key = (app, path)
            if self.command in ('GET', 'HEAD'):
                it = STORE.get(key)
                if not it or it['dir'] or not alive(it):
                    return self.json(404, {'error': 'not found'})
                return self.serve(it)
            if not precondition(self.headers, STORE.get(key)):
                return self.json(412, {'error': 'precondition failed'})
            if self.command == 'PUT':
                h = self.headers
                exp = h.get('x-utilities-expires')
                it = {'data': self.body(), 'type': h.get('Content-Type') or 'application/octet-stream',
                      'modified': now_ms(), 'public': h.get('x-utilities-public') == 'true',
                      'burn': h.get('x-utilities-burn') == 'true',
                      'expires': int(exp) if exp else None, 'dir': False}
                STORE[key] = it
                pub = f'/utilities/pub/{app}/' + '/'.join(quote(s) for s in path.split('/'))
                return self.send(200, json.dumps({'path': path, 'public_url': pub if it['public'] else None}),
                                 'application/json', {'ETag': etag(it)})
            if self.command == 'DELETE':
                STORE.pop(key, None)
                return self.send(204)
            if self.command == 'POST':  # change flags without re-uploading
                it = STORE.get(key)
                if not it or it['dir'] or not alive(it):
                    return self.json(404, {'error': 'not found'})
                try:
                    d = json.loads(self.body() or b'')
                    assert isinstance(d, dict)
                except (ValueError, AssertionError):
                    return self.json(400, {'error': 'bad body'})
                if isinstance(d.get('public'), bool):
                    it['public'] = d['public']
                if isinstance(d.get('burn'), bool):
                    it['burn'] = d['burn']
                if 'expires' in d and (d['expires'] is None or isinstance(d['expires'], int)):
                    it['expires'] = d['expires']
                pub = f'/utilities/pub/{app}/' + '/'.join(quote(s) for s in path.split('/'))
                return self.json(200, {'path': path, 'public_url': pub if it['public'] else None})
        return self.json(405, {'error': 'method not allowed'})

    def pub(self, rest):
        if self.command not in ('GET', 'HEAD'):
            return self.send(405, 'method not allowed')
        parts = [unquote(s) for s in rest.split('/')]
        if len(parts) < 2:
            return self.send(404, 'not found')
        key = (parts[0], '/'.join(parts[1:]))
        with LOCK:
            it = STORE.get(key)
            if not it or it['dir'] or not it['public'] or not alive(it):
                return self.send(404, 'not found', headers={'Cache-Control': 'no-store'})
            # burn once content has gone out (a partial read counts)
            rng = parse_range(self.headers.get('Range'), len(it['data']))
            inm = self.headers.get('If-None-Match')
            sends = rng != () and not (rng is None and inm is not None and etag_in(inm, etag(it)))
            if it['burn'] and self.command == 'GET' and sends:
                del STORE[key]
        self.serve(it, {'Cache-Control': 'no-store'})

    # -- webdav ----------------------------------------------------------
    def dav(self, rest):
        if not self.authed():
            return self.send(401, 'unauthorized', headers={'WWW-Authenticate': 'Basic realm="urbit"'})
        method = self.command
        if method == 'POST':
            over = (self.headers.get('X-HTTP-Method-Override') or '').upper()
            if over not in DAV_METHODS:
                return self.send(405, 'method not allowed')
            method = over
        segs = [unquote(s) for s in rest.split('/')]
        app = segs[0]
        if not re.match(r'^[a-z0-9-]+$', app or ''):
            return self.send(404, 'not found')
        path = '/'.join(s for s in segs[1:] if s)
        with LOCK:
            return getattr(self, 'dav_' + method.lower())(app, path)

    def dav_kind(self, app, path):
        if path == '':
            return 'dir'
        it = STORE.get((app, path))
        if it and alive(it):
            return 'dir' if it['dir'] else 'file'
        pre = path + '/'
        if any(a == app and p.startswith(pre) for a, p in STORE):
            return 'dir'
        return None

    def dav_options(self, app, path):
        self.send(200, '', headers={'DAV': '1,2', 'MS-Author-Via': 'DAV', 'Allow':
              'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK'})

    def dav_get(self, app, path):
        it = STORE.get((app, path))
        if not it or it['dir'] or not alive(it):
            return self.send(404, 'not found')
        self.serve(it, {'Last-Modified': rfc1123(it['modified'])})
    dav_head = dav_get

    def dav_put(self, app, path):
        if not path:
            return self.send(405, 'cannot PUT a collection')
        if not precondition(self.headers, STORE.get((app, path))):
            return self.send(412, 'precondition failed')
        existed = (app, path) in STORE
        it = STORE[(app, path)] = {'data': self.body(), 'type': self.headers.get('Content-Type') or 'application/octet-stream',
                                   'modified': now_ms(), 'public': False, 'burn': False, 'expires': None, 'dir': False}
        self.send(204 if existed else 201, headers={'ETag': etag(it)})

    def dav_delete(self, app, path):
        kind = self.dav_kind(app, path)
        if not kind:
            return self.send(404, 'not found')
        if not precondition(self.headers, STORE.get((app, path))):
            return self.send(412, 'precondition failed')
        for k in [k for k in STORE if k[0] == app and (k[1] == path or k[1].startswith(path + '/') or path == '')]:
            del STORE[k]
        self.send(204)

    def dav_mkcol(self, app, path):
        self.body()
        if self.dav_kind(app, path):
            return self.send(405, 'exists')
        STORE[(app, path)] = {'data': b'', 'type': 'httpd/unix-directory', 'modified': now_ms(),
                              'public': False, 'burn': False, 'expires': None, 'dir': True}
        self.send(201)

    def dav_entries(self, app, path, depth):
        kind = self.dav_kind(app, path)
        out = [(path, kind)]
        if kind == 'dir' and depth != '0':
            pre = path + '/' if path else ''
            kids = {}
            for (a, p), it in STORE.items():
                if a == app and p.startswith(pre) and p != path and alive(it):
                    tail = p[len(pre):].split('/')
                    child = pre + tail[0]
                    kids[child] = 'dir' if len(tail) > 1 or it['dir'] or kids.get(child) == 'dir' else 'file'
            out += sorted(kids.items())
        return out

    def dav_propfind(self, app, path):
        self.body()
        if not self.dav_kind(app, path):
            return self.send(404, 'not found')
        depth = self.headers.get('Depth', '1')
        resp = []
        for p, kind in self.dav_entries(app, path, depth):
            href = '/utilities/dav/' + app + '/' + '/'.join(quote(s) for s in p.split('/') if s)
            name = p.split('/')[-1] if p else app
            it = STORE.get((app, p))
            ms = it['modified'] if it else now_ms()
            if kind == 'dir':
                href = href.rstrip('/') + '/'
                props = ('<D:resourcetype><D:collection/></D:resourcetype>'
                         '<D:getcontentlength>0</D:getcontentlength>'
                         '<D:getcontenttype>httpd/unix-directory</D:getcontenttype>'
                         '<D:getetag>"dir"</D:getetag>')
            else:
                props = ('<D:resourcetype/>'
                         f'<D:getcontentlength>{len(it["data"])}</D:getcontentlength>'
                         f'<D:getcontenttype>{html.escape(it["type"])}</D:getcontenttype>'
                         f'<D:getetag>{html.escape(etag(it))}</D:getetag>')
            resp.append(f'<D:response><D:href>{html.escape(href)}</D:href><D:propstat><D:prop>'
                        f'<D:displayname>{html.escape(name)}</D:displayname>{props}'
                        f'<D:getlastmodified>{rfc1123(ms)}</D:getlastmodified>'
                        f'<D:creationdate>{iso(ms)}</D:creationdate>'
                        '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>')
        xml = '<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">' + ''.join(resp) + '</D:multistatus>'
        self.send(207, xml, 'application/xml; charset=utf-8')

    def dav_proppatch(self, app, path):
        self.body()
        href = '/utilities/dav/' + app + '/' + quote(path)
        xml = ('<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:"><D:response>'
               f'<D:href>{html.escape(href)}</D:href><D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status>'
               '</D:propstat></D:response></D:multistatus>')
        self.send(207, xml, 'application/xml; charset=utf-8')

    def dav_copy(self, app, path, move=False):
        dest = unquote(urlsplit(self.headers.get('Destination', '')).path)
        m = re.match(r'^/utilities/dav/([a-z0-9-]+)/(.*)$', dest)
        if not m:
            return self.send(400, 'bad destination')
        dapp, dpath = m.group(1), m.group(2).strip('/')
        if not self.dav_kind(app, path):
            return self.send(404, 'not found')
        exists = self.dav_kind(dapp, dpath) is not None
        if exists and self.headers.get('Overwrite', 'T').upper() == 'F':
            return self.send(412, 'precondition failed')
        if exists:
            for k in [k for k in STORE if k[0] == dapp and (k[1] == dpath or k[1].startswith(dpath + '/'))]:
                del STORE[k]
        for (a, p), it in list(STORE.items()):
            if a == app and (p == path or p.startswith(path + '/')):
                STORE[(dapp, dpath + p[len(path):])] = dict(it, modified=now_ms())
                if move:
                    del STORE[(a, p)]
        self.send(204 if exists else 201)

    def dav_move(self, app, path):
        self.dav_copy(app, path, move=True)

    def dav_lock(self, app, path):
        self.body()
        tok = 'opaquelocktoken:%s' % hashlib.sha1(f'{app}/{path}{time.time()}'.encode()).hexdigest()
        xml = ('<?xml version="1.0" encoding="utf-8"?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>'
               '<D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope>'
               '<D:depth>infinity</D:depth><D:timeout>Second-3600</D:timeout>'
               f'<D:locktoken><D:href>{tok}</D:href></D:locktoken></D:activelock></D:lockdiscovery></D:prop>')
        self.send(200, xml, 'application/xml; charset=utf-8', {'Lock-Token': f'<{tok}>'})

    def dav_unlock(self, app, path):
        self.send(204)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8200)
    ap.add_argument('--publisher', default='~nus')
    ap.add_argument('-v', '--verbose', action='store_true')
    a = ap.parse_args()
    srv = ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    srv.publisher, srv.verbose = a.publisher, a.verbose
    srv.default_publisher = a.publisher
    print(f'mock ship on http://localhost:{a.port}  desks: {" ".join(desk_dirs())}', flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
