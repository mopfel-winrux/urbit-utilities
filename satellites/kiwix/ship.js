// Kiwix satellite: ZIM archives stored on the Urbit ship (%utilities hub store).
// List:   GET    /utilities/api/store/kiwix/            (JSON array, we show *.zim)
// Upload: PUT    /utilities/api/store/kiwix/<name>.zim  (raw bytes)
// Open:   GET    /utilities/api/store/kiwix/<name>.zim  with Range, read lazily (see remoteFile)
// Delete: DELETE /utilities/api/store/kiwix/<name>.zim
// kiwix-js only reads slices (file.slice(a, b).arrayBuffer()), so an archive on the
// ship is opened without downloading it: each read becomes a Range request, cached
// in 64 kB blocks.
(function () {
    'use strict';
    var API = '/utilities/api/store/kiwix/';
    var enc = function (p) { return p.split('/').map(encodeURIComponent).join('/'); };
    var $ = function (id) { return document.getElementById(id); };
    var fmt = function (n) {
        return n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' kB';
    };
    var status = function (msg, err) {
        var s = $('shipStatus');
        s.textContent = msg || '';
        s.style.color = err ? '#c00' : '';
    };

    function xhr (method, url, body, onProgress, type) {
        return new Promise(function (resolve, reject) {
            var r = new XMLHttpRequest();
            r.open(method, url);
            r.withCredentials = true;
            if (type) r.responseType = type;
            var target = method === 'PUT' ? r.upload : r;
            target.onprogress = function (e) { if (onProgress) onProgress(e.loaded, e.lengthComputable ? e.total : 0); };
            r.onload = function () {
                if (r.status >= 200 && r.status < 300) resolve(r);
                else reject(new Error(method + ' ' + url + ': HTTP ' + r.status + (r.status === 401 ? ' (log in to your ship)' : '')));
            };
            r.onerror = function () { reject(new Error(method + ' ' + url + ': network error')); };
            if (method === 'PUT') r.setRequestHeader('Content-Type', 'application/octet-stream');
            r.send(body || null);
        });
    }

    function refresh () {
        var list = $('shipZimList');
        return fetch(API, { credentials: 'same-origin' }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status + (res.status === 401 ? ' (log in to your ship)' : ''));
            return res.json();
        }).then(function (rows) {
            var zims = rows.filter(function (r) { return /\.zim$/i.test(r.path); });
            list.innerHTML = '';
            if (!zims.length) {
                list.innerHTML = '<li class="list-group-item text-muted">No ZIM archives on your ship yet.</li>';
                return zims;
            }
            zims.forEach(function (r) {
                var li = document.createElement('li');
                li.className = 'list-group-item d-flex justify-content-between align-items-center';
                li.dataset.path = r.path;
                var name = document.createElement('span');
                name.className = 'ship-zim-name';
                name.textContent = r.path + ' (' + fmt(r.size) + ')';
                var btns = document.createElement('span');
                var open = document.createElement('button');
                open.type = 'button';
                open.className = 'btn btn-primary btn-sm ship-open';
                open.textContent = 'Open';
                open.onclick = function () { openFromShip(r.path, r.size); };
                var del = document.createElement('button');
                del.type = 'button';
                del.className = 'btn btn-light btn-sm ship-delete';
                del.style.marginLeft = '0.5em';
                del.textContent = 'Delete';
                del.onclick = function () {
                    if (!window.confirm('Delete ' + r.path + ' from your ship?')) return;
                    fetch(API + enc(r.path), { method: 'DELETE', credentials: 'same-origin' }).then(refresh)
                        .catch(function (e) { status(e.message, true); });
                };
                btns.append(open, del);
                li.append(name, btns);
                list.appendChild(li);
            });
            return zims;
        }).catch(function (e) {
            list.innerHTML = '';
            status('Could not list ZIMs on your ship: ' + e.message, true);
        });
    }

    var BLOCK = 65536; // bytes per cached block
    var MAX_BLOCKS = 512; // 32 MB of cache per archive

    // A read-only, File-like view of a stored item: slice(a, b).arrayBuffer()
    // fetches just those bytes with a Range request. Blocks are cached (LRU) and
    // neighbouring missing blocks are fetched in one request.
    function remoteFile (url, name, size) {
        var cache = new Map(); // block index -> Promise<Uint8Array>
        var stats = { requests: 0, bytes: 0 };

        function fetchBlocks (i, j) {
            var start = i * BLOCK;
            var end = Math.min((j + 1) * BLOCK, size) - 1;
            stats.requests++;
            return fetch(url, { credentials: 'same-origin', headers: { Range: 'bytes=' + start + '-' + end } }).then(function (r) {
                if (r.status !== 206 && r.status !== 200) throw new Error('GET ' + url + ': HTTP ' + r.status);
                return r.arrayBuffer().then(function (buf) {
                    var bytes = new Uint8Array(buf);
                    // a server that ignores Range sends the whole file
                    if (r.status === 200) bytes = bytes.subarray(start, end + 1);
                    stats.bytes += bytes.length;
                    return bytes;
                });
            });
        }

        function block (k, run, i) {
            var p = run.then(function (bytes) {
                return bytes.subarray((k - i) * BLOCK, Math.min((k - i + 1) * BLOCK, bytes.length));
            });
            p.catch(function () { cache.delete(k); });
            cache.set(k, p);
            return p;
        }

        function read (start, end) { // end exclusive
            if (end <= start) return Promise.resolve(new Uint8Array(0));
            var first = Math.floor(start / BLOCK);
            var last = Math.floor((end - 1) / BLOCK);
            var parts = [];
            for (var i = first; i <= last;) {
                if (cache.has(i)) {
                    var hit = cache.get(i);
                    cache.delete(i); cache.set(i, hit); // most recently used
                    parts.push(hit);
                    i++;
                    continue;
                }
                var j = i;
                while (j < last && !cache.has(j + 1)) j++;
                var run = fetchBlocks(i, j);
                for (var k = i; k <= j; k++) parts.push(block(k, run, i));
                i = j + 1;
            }
            while (cache.size > MAX_BLOCKS) cache.delete(cache.keys().next().value);
            return Promise.all(parts).then(function (blocks) {
                var out = new Uint8Array(end - start);
                var pos = first * BLOCK;
                blocks.forEach(function (b) {
                    var from = Math.max(start, pos);
                    var to = Math.min(end, pos + b.length);
                    if (to > from) out.set(b.subarray(from - pos, to - pos), from - start);
                    pos += b.length;
                });
                return out;
            });
        }

        function view (start, end) {
            return {
                size: end - start,
                arrayBuffer: function () { return read(start, end).then(function (u) { return u.buffer; }); }
            };
        }

        return {
            name: name,
            size: size,
            type: 'application/octet-stream',
            lastModified: Date.now(),
            fromShip: true,
            stats: stats,
            slice: function (a, b) {
                a = Math.max(0, a || 0);
                b = b === undefined ? size : Math.min(b, size);
                return view(a, Math.max(a, b));
            },
            arrayBuffer: function () { return read(0, size).then(function (u) { return u.buffer; }); }
        };
    }

    function openFromShip (path, size) {
        var name = path.split('/').pop();
        var file = remoteFile(API + enc(path), name, size);
        window.kiwixShip.current = file;
        status('Opened ' + name + ' from your ship (' + fmt(size) + ', read on demand).');
        window.setLocalArchiveFromFileList([file]);
        return Promise.resolve(file);
    }

    function upload (files) {
        var chain = Promise.resolve();
        Array.prototype.forEach.call(files, function (f) {
            chain = chain.then(function () {
                if (!/\.zim$/i.test(f.name)) throw new Error(f.name + ' is not a .zim file (split .zimaa archives are not supported here)');
                status('Uploading ' + f.name + '...');
                return xhr('PUT', API + enc(f.name), f, function (loaded) {
                    status('Uploading ' + f.name + ': ' + fmt(loaded) + ' / ' + fmt(f.size));
                }).then(function () { status('Saved ' + f.name + ' to your ship.'); });
            });
        });
        return chain.then(refresh).catch(function (e) { status(e.message, true); });
    }

    function init () {
        $('shipUploadInput').addEventListener('change', function (e) {
            upload(e.target.files).then(function () { e.target.value = ''; });
        });
        $('shipRefresh').addEventListener('click', function () { status(''); refresh(); });
        refresh();
    }
    window.kiwixShip = { refresh: refresh, open: openFromShip, upload: upload };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
