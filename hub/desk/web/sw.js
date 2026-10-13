// %utilities hub service worker (scope /utilities/).
// Caches only the UI shell and static files, network-first so a new commit
// shows up on the next load and the cache is just an offline fallback.
// It never touches /utilities/api, /utilities/dav or /utilities/pub: those
// are live data (and pub/burn reads must never be replayed from a cache).
var CACHE = 'utilities-shell-v1';
var SHELL = ['/utilities/', '/utilities/app.js', '/utilities/app.css', '/utilities/icon.svg',
             '/utilities/manifest.webmanifest', '/utilities/icons/index.json'];
var LIVE = /^\/utilities\/(api|dav|pub)(\/|$)/;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) {
      return fetch(u, { credentials: 'same-origin' }).then(function (r) { if (r.ok) return c.put(u, r); }).catch(function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.indexOf('/utilities/') !== 0 || LIVE.test(url.pathname)) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok && res.type === 'basic') {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || (req.mode === 'navigate' ? caches.match('/utilities/') : Response.error());
    });
  }));
});
