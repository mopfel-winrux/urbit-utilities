// %office service worker.
// 1. Cross-origin isolation: LibreOffice's wasm build uses pthreads, which
//    need SharedArrayBuffer, which needs COOP/COEP headers. The Urbit
//    fileserver can't send them, so this worker adds them to every response
//    under its scope (the coi-serviceworker technique).
// 2. The big binaries are stored gzipped on the desk (soffice.wasm.gz,
//    soffice.data.gz) because the fileserver can't send Content-Encoding.
//    Requests for soffice.wasm / soffice.data are answered from the .gz,
//    decompressed here with DecompressionStream.
// 3. Offline/PWA: versioned cache. Assets cache-first, pages network-first.
//    Login redirects, errors and anything outside the scope are never cached.
const VERSION = "__VERSION__";
const CACHE = `office-${VERSION}`;
const SCOPE = new URL(self.registration.scope).pathname;
const GZ = { "soffice.wasm": "application/wasm", "soffice.data": "application/octet-stream" };

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
	e.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k.startsWith("office-") && k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim()),
	);
});

const cacheable = (res) => res && res.status === 200 && !res.redirected && res.type === "basic";

function isolate(res, type) {
	if (!res || res.status === 0 || res.type === "opaqueredirect") return res;
	const h = new Headers(res.headers);
	h.set("Cross-Origin-Opener-Policy", "same-origin");
	h.set("Cross-Origin-Embedder-Policy", "require-corp");
	h.set("Cross-Origin-Resource-Policy", "same-origin");
	if (type) {
		h.set("Content-Type", type);
		h.delete("Content-Length");
	}
	return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

async function cached(cache, url) {
	const hit = await cache.match(url);
	if (hit) return hit;
	const res = await fetch(url, { credentials: "same-origin" });
	if (cacheable(res)) await cache.put(url, res.clone());
	return res;
}

async function gunzipped(name) {
	const cache = await caches.open(CACHE);
	const res = await cached(cache, SCOPE + name + ".gz");
	if (!res.ok || res.redirected) return new Response("login required or missing: " + name, { status: 503 });
	const body = res.body.pipeThrough(new DecompressionStream("gzip"));
	return isolate(new Response(body, { status: 200, headers: res.headers }), GZ[name]);
}

self.addEventListener("fetch", (e) => {
	const req = e.request;
	const url = new URL(req.url);
	// the hub API (/utilities/...) and other desks pass straight through
	if (url.origin !== location.origin || !url.pathname.startsWith(SCOPE)) return;
	if (req.method !== "GET") return;
	const name = url.pathname.slice(SCOPE.length);
	if (GZ[name]) {
		e.respondWith(gunzipped(name));
		return;
	}
	if (req.mode === "navigate") {
		e.respondWith(
			fetch(req)
				.then((res) => {
					if (cacheable(res)) {
						const copy = res.clone();
						caches.open(CACHE).then((c) => c.put(req, copy));
					}
					return isolate(res);
				})
				.catch(() => caches.match(req).then((r) => isolate(r || Response.error()))),
		);
		return;
	}
	e.respondWith(caches.open(CACHE).then((c) => cached(c, req)).then((res) => isolate(res)));
});
