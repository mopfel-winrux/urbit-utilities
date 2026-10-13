// %utilities satellite service worker (installed by kit/pwa.py).
// Scope is the satellite's web root (/<desk>/). Pages: network first with the
// cached shell as the offline fallback. Assets: cache first, refreshed in the
// background. Login redirects and errors are never cached.
const VERSION = "__VERSION__";
const CACHE = `sat-${VERSION}`;
const SCOPE = new URL(self.registration.scope).pathname;
const SHELL = SCOPE; // the root index.html

self.addEventListener("install", (e) => {
	e.waitUntil(
		caches.open(CACHE).then((c) => c.add(new Request(SHELL, { credentials: "same-origin" }))).catch(() => {}),
	);
	self.skipWaiting();
});

self.addEventListener("activate", (e) => {
	e.waitUntil(
		caches.keys().then((keys) =>
			Promise.all(keys.filter((k) => k.startsWith("sat-") && k !== CACHE).map((k) => caches.delete(k))),
		).then(() => self.clients.claim()),
	);
});

const cacheable = (res) => res && res.ok && !res.redirected && res.type === "basic";

self.addEventListener("fetch", (e) => {
	const req = e.request;
	const url = new URL(req.url);
	if (req.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith(SCOPE)) return;

	if (req.mode === "navigate") {
		e.respondWith(
			fetch(req)
				.then((res) => {
					if (cacheable(res) && url.pathname === SHELL) {
						const copy = res.clone();
						caches.open(CACHE).then((c) => c.put(SHELL, copy));
					}
					return res;
				})
				.catch(() => caches.match(req).then((r) => r || caches.match(SHELL))),
		);
		return;
	}

	// the cache name changes with every build, so a hit is always current:
	// serve it without refetching (large wasm/models would download twice)
	e.respondWith(
		caches.open(CACHE).then((c) =>
			c.match(req).then(
				(hit) =>
					hit ||
					fetch(req).then((res) => {
						if (cacheable(res)) c.put(req, res.clone());
						return res;
					}),
			),
		),
	);
});
