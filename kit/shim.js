// %utilities WebDAV method-override shim.
// Vere only accepts standard HTTP methods, so WebDAV verbs (PROPFIND, MKCOL,
// MOVE, ...) to /utilities/dav/ are tunneled as POST + X-HTTP-Method-Override.
// Load this before the app's own scripts.
(function () {
	var NATIVE = { GET: 1, HEAD: 1, PUT: 1, POST: 1, DELETE: 1, OPTIONS: 1 };
	var isDav = function (url) {
		try {
			return new URL(url, location.href).pathname.indexOf("/utilities/dav/") !== -1;
		} catch (e) {
			return false;
		}
	};
	var tunnel = function (method, url) {
		method = String(method || "GET").toUpperCase();
		return !NATIVE[method] && isDav(url) ? method : null;
	};

	var origFetch = window.fetch;
	window.fetch = function (input, init) {
		var req = input instanceof Request ? input : null;
		var url = req ? req.url : String(input);
		var method = (init && init.method) || (req && req.method) || "GET";
		var over = tunnel(method, url);
		if (!over) return origFetch.apply(this, arguments);
		var headers = new Headers((init && init.headers) || (req && req.headers) || {});
		headers.set("X-HTTP-Method-Override", over);
		var opts = Object.assign({}, init || {}, { method: "POST", headers: headers });
		if (req && !(init && "body" in init)) {
			return req.clone().arrayBuffer().then(function (body) {
				opts.body = body.byteLength ? body : undefined;
				return origFetch.call(window, url, opts);
			});
		}
		return origFetch.call(window, url, opts);
	};

	var open = XMLHttpRequest.prototype.open;
	var send = XMLHttpRequest.prototype.send;
	XMLHttpRequest.prototype.open = function (method, url) {
		var over = tunnel(method, url);
		this.__davOverride = over;
		var args = Array.prototype.slice.call(arguments);
		if (over) args[0] = "POST";
		return open.apply(this, args);
	};
	XMLHttpRequest.prototype.send = function () {
		if (this.__davOverride) this.setRequestHeader("X-HTTP-Method-Override", this.__davOverride);
		return send.apply(this, arguments);
	};
})();
