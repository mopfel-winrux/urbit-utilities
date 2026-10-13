// %utilities hub UI: launcher, catalog (install/uninstall) and storage browser.
// Talks only to the hub API under /utilities/api (see kit/CONTRACT.md).
(function () {
  'use strict';
  var API = '/utilities/api';
  var POLL_MS = 2000;
  var CATEGORY_HUES = { files: 215, graphics: 330, developer: 150, productivity: 35, social: 265, games: 5, knowledge: 185 };

  var state = {
    catalog: [], publisher: '', icons: {}, category: 'all', query: '',
    busy: {},            // desk -> 'install' | 'uninstall' while we wait for the status to flip
    since: {},           // desk -> ms when we started waiting
    storeApps: [], storeApp: null, items: []
  };
  var pollTimer = null;

  // ---------- helpers ----------
  function $(sel) { return document.querySelector(sel); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    (kids || []).forEach(function (c) { if (c != null) n.append(c); });
    return n;
  }
  function api(method, path, body) {
    var opts = { method: method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
    return fetch(API + path, opts).then(function (r) {
      if (r.status === 401) { location.href = '/~/login?redirect=' + encodeURIComponent(location.pathname + location.hash); throw new Error('login required'); }
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || ('HTTP ' + r.status)); });
      return r.status === 204 ? r.text().then(function () { return null; }) : r.json();
    });
  }
  function toast(msg, error) {
    var t = el('div', { class: 'toast' + (error ? ' error' : ''), role: 'status', text: msg });
    $('#toasts').append(t);
    setTimeout(function () { t.remove(); }, 3500);
  }
  function confirmBox(title, text, ok) {
    var d = $('#confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-ok').textContent = ok || 'OK';
    return new Promise(function (resolve) {
      d.addEventListener('close', function f() { d.removeEventListener('close', f); resolve(d.returnValue === 'ok'); });
      d.returnValue = '';
      d.showModal();
    });
  }
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    var u = ['KB', 'MB', 'GB'], i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
  }
  function fmtDate(ms) {
    var d = new Date(ms), now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                   : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function hue(app) {
    if (app && CATEGORY_HUES[app.category] != null) return CATEGORY_HUES[app.category];
    var s = (app && (app.category || app.desk)) || '', h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }
  function icon(app, desk) {
    desk = desk || app.desk;
    var src = state.icons[desk + '.svg'] ? desk + '.svg' : state.icons[desk + '.png'] ? desk + '.png' : null;
    if (src) {
      return el('span', { class: 'icon', style: 'background:var(--surface-2)' },
        [el('img', { src: '/utilities/icons/' + src, alt: '', loading: 'lazy' })]);
    }
    var h = hue(app);
    var letter = ((app && app.title) || desk || '?').trim().charAt(0).toUpperCase();
    return el('span', {
      class: 'icon', 'aria-hidden': 'true',
      style: 'background:linear-gradient(135deg,hsl(' + h + ' 72% 58%),hsl(' + ((h + 28) % 360) + ' 68% 46%))',
      text: letter
    });
  }
  function byDesk(desk) {
    for (var i = 0; i < state.catalog.length; i++) if (state.catalog[i].desk === desk) return state.catalog[i];
    return null;
  }

  // ---------- catalog ----------
  function loadCatalog() {
    return api('GET', '/catalog').then(function (c) {
      var before = {};
      state.catalog.forEach(function (a) { before[a.desk] = a.status; });
      state.catalog = c.apps || [];
      state.publisher = c.publisher || '';
      state.catalog.forEach(function (a) {
        var want = state.busy[a.desk];
        if (want === 'install' && a.status === 'installed') {
          delete state.busy[a.desk]; toast(a.title + ' installed');
        } else if (want === 'uninstall' && a.status !== 'installed' && a.status !== 'installing') {
          delete state.busy[a.desk]; toast(a.title + ' uninstalled');
        }
      });
      renderApps();
      schedulePoll();
    });
  }
  function schedulePoll() {
    var waiting = Object.keys(state.busy).length > 0 ||
      state.catalog.some(function (a) { return a.status === 'installing'; });
    clearTimeout(pollTimer);
    if (waiting) pollTimer = setTimeout(function () { loadCatalog().catch(function () { schedulePoll(); }); }, POLL_MS);
  }
  function install(app) {
    state.busy[app.desk] = 'install'; state.since[app.desk] = Date.now();
    renderApps();
    api('POST', '/install', { desk: app.desk }).then(loadCatalog).catch(function (e) {
      delete state.busy[app.desk]; renderApps(); toast('Could not install ' + app.title + ': ' + e.message, true);
    });
  }
  function uninstall(app) {
    confirmBox('Uninstall ' + app.title + '?',
      'The app stops running on your ship. Files it saved stay in Storage.', 'Uninstall').then(function (yes) {
      if (!yes) return;
      state.busy[app.desk] = 'uninstall'; state.since[app.desk] = Date.now();
      renderApps();
      api('POST', '/uninstall', { desk: app.desk }).then(loadCatalog).catch(function (e) {
        delete state.busy[app.desk]; renderApps(); toast('Could not uninstall ' + app.title + ': ' + e.message, true);
      });
    });
  }

  function renderApps() {
    var installed = state.catalog.filter(function (a) { return a.status === 'installed' && state.busy[a.desk] !== 'uninstall'; });
    var box = $('#installed');
    box.replaceChildren();
    if (!installed.length) {
      box.append(el('p', { class: 'empty', text: 'No apps installed yet. Pick some from the catalog below.' }));
      box.style.display = 'block';
    } else {
      box.style.display = '';
      installed.forEach(function (a) {
        box.append(el('a', {
          class: 'tile', href: a.href, target: '_blank', rel: 'noopener', title: a.info, 'data-desk': a.desk
        }, [icon(a), el('span', { class: 'name', text: a.title })]));
      });
    }
    $('#installed-count').textContent = installed.length ? installed.length + ' installed' : '';
    $('#publisher').textContent = state.publisher ? 'from ' + state.publisher : '';
    renderCats();
    renderCatalog();
  }

  function renderCats() {
    var cats = ['all'];
    state.catalog.forEach(function (a) { if (a.category && cats.indexOf(a.category) < 0) cats.push(a.category); });
    var box = $('#cats');
    box.replaceChildren();
    cats.forEach(function (c) {
      box.append(el('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(state.category === c), text: c,
        onclick: function () { state.category = c; renderCats(); renderCatalog(); }
      }));
    });
  }

  function statusOf(a) {
    var busy = state.busy[a.desk];
    if (busy === 'install' && a.status !== 'installed') return 'installing';
    if (busy === 'uninstall') return 'uninstalling';
    return a.status;
  }

  function renderCatalog() {
    var q = state.query.trim().toLowerCase();
    var list = state.catalog.filter(function (a) {
      if (state.category !== 'all' && a.category !== state.category) return false;
      if (!q) return true;
      return [a.title, a.info, a.desk, a.category].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var box = $('#catalog');
    box.replaceChildren();
    list.forEach(function (a) {
      var st = statusOf(a);
      var badges = [el('span', { class: 'badge', text: a.category })];
      if (a.tier === 2) badges.push(el('span', { class: 'badge tier2', text: 'saves to your ship' }));
      if (st === 'installed') badges.push(el('span', { class: 'badge installed', text: 'installed' }));
      if (st === 'suspended') badges.push(el('span', { class: 'badge', text: 'suspended' }));
      var actions;
      if (st === 'installing' || st === 'uninstalling') {
        var waited = Date.now() - (state.since[a.desk] || Date.now());
        var label = st === 'installing'
          ? (waited > 60000 ? 'Still waiting for ' + (state.publisher || 'the publisher') + '…' : 'Installing…')
          : 'Uninstalling…';
        actions = [el('div', { class: 'progress', role: 'progressbar', 'aria-label': label },
          [el('span', { text: label }), el('div', { class: 'bar' })])];
        if (st === 'installing') {
          actions.push(el('button', { class: 'btn ghost small', type: 'button', text: 'Cancel', onclick: function () { uninstall(a); } }));
        }
      } else if (st === 'installed') {
        actions = [
          el('a', { class: 'btn', href: a.href, target: '_blank', rel: 'noopener', text: 'Open' }),
          el('button', { class: 'btn danger-ghost', type: 'button', text: 'Uninstall', onclick: function () { uninstall(a); } })
        ];
      } else {
        actions = [el('button', {
          class: 'btn', type: 'button', text: st === 'suspended' ? 'Reinstall' : 'Install',
          onclick: function () { install(a); }
        })];
      }
      box.append(el('article', { class: 'card', 'data-desk': a.desk, 'data-status': st }, [
        el('div', { class: 'card-top' }, [icon(a), el('div', {}, [
          el('h3', { text: a.title }), el('p', { class: 'info', text: a.info })
        ])]),
        el('div', { class: 'meta' }, badges),
        el('div', { class: 'actions' }, actions)
      ]));
    });
    $('#catalog-empty').hidden = list.length > 0;
  }

  // ---------- storage ----------
  function loadStore() {
    return api('GET', '/store/').then(function (apps) {
      state.storeApps = apps;
      if (!state.storeApp || !apps.some(function (a) { return a.app === state.storeApp; })) {
        state.storeApp = apps.length ? apps[0].app : null;
      }
      renderStoreApps();
      return state.storeApp ? loadItems() : renderItems();
    });
  }
  function loadItems() {
    var app = state.storeApp;
    return api('GET', '/store/' + app + '/').then(function (items) {
      if (app !== state.storeApp) return;
      state.items = items;
      renderItems();
    });
  }
  function renderStoreApps() {
    var box = $('#store-apps');
    box.replaceChildren();
    state.storeApps.forEach(function (s) {
      var meta = byDesk(s.app);
      box.append(el('button', {
        class: 'store-app', type: 'button', 'aria-current': String(s.app === state.storeApp), 'data-app': s.app,
        onclick: function () { state.storeApp = s.app; renderStoreApps(); loadItems(); }
      }, [icon(meta || { desk: s.app, title: s.app }, s.app), el('span', {}, [
        document.createTextNode(meta ? meta.title : s.app),
        el('small', { text: s.count + (s.count === 1 ? ' item · ' : ' items · ') + fmtSize(s.size) })
      ])]));
    });
  }
  function itemUrl(app, path) {
    return API + '/store/' + app + '/' + path.split('/').map(encodeURIComponent).join('/');
  }
  function renderItems() {
    var head = $('#store-head'), box = $('#store-items');
    head.replaceChildren(); box.replaceChildren();
    if (!state.storeApp) {
      box.append(el('p', { class: 'empty', text: 'Nothing stored yet. Apps that save to your ship will show their files here.' }));
      return;
    }
    var meta = byDesk(state.storeApp);
    head.append(el('h3', { text: meta ? meta.title : state.storeApp }),
      el('span', { class: 'muted', text: state.items.length + (state.items.length === 1 ? ' item' : ' items') }));
    if (!state.items.length) { box.append(el('p', { class: 'empty', text: 'No items.' })); return; }
    var rows = state.items.map(function (it) {
      var app = state.storeApp;
      var link = it.public ? location.origin + '/utilities/pub/' + app + '/' + it.path.split('/').map(encodeURIComponent).join('/') : null;
      var flags = [];
      if (it.burn) flags.push(el('span', { class: 'badge warn', text: 'burn after reading' }));
      if (it.expires) flags.push(el('span', { class: 'badge', text: 'expires ' + fmtDate(it.expires) }));
      return el('tr', { 'data-path': it.path }, [
        el('td', { class: 'path' }, [
          el('a', { href: itemUrl(app, it.path), target: '_blank', rel: 'noopener', text: it.path }),
          el('div', { class: 'type', text: it.type }), flags.length ? el('div', { class: 'meta' }, flags) : null
        ]),
        el('td', { class: 'num', text: fmtSize(it.size) }),
        el('td', { class: 'when hide-sm', title: new Date(it.modified).toLocaleString(), text: fmtDate(it.modified) }),
        el('td', {}, [el('label', { class: 'switch' }, [
          el('input', { type: 'checkbox', role: 'switch', checked: it.public, 'aria-label': 'Public link for ' + it.path,
            onchange: function (e) { setPublic(it, e.target.checked, e.target); } }),
          el('span', { class: 'hide-sm', text: it.public ? 'Public' : 'Private' })
        ])]),
        el('td', { class: 'acts' }, [
          link ? el('button', { class: 'btn ghost small copy', type: 'button', text: 'Copy link', onclick: function () { copy(link); } }) : null,
          el('button', { class: 'btn danger-ghost small del', type: 'button', text: 'Delete', onclick: function () { del(it); } })
        ])
      ]);
    });
    box.append(el('table', { class: 'items' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Name' }), el('th', { class: 'num', text: 'Size' }),
        el('th', { class: 'hide-sm', text: 'Modified' }), el('th', { text: 'Public' }), el('th', {})
      ])]),
      el('tbody', {}, rows)
    ]));
  }
  function setPublic(it, pub, input) {
    input.disabled = true;
    api('POST', '/store/' + state.storeApp + '/' + it.path.split('/').map(encodeURIComponent).join('/'), { public: pub })
      .then(function (r) {
        it.public = pub;
        renderItems();
        if (pub && r.public_url) copy(location.origin + r.public_url, 'Public link copied');
        else toast(it.path + ' is private');
      })
      .catch(function (e) { input.disabled = false; input.checked = !pub; toast(e.message, true); });
  }
  function copy(text, msg) {
    var done = function () { toast(msg || 'Link copied'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = el('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text;
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }
  function del(it) {
    confirmBox('Delete ' + it.path + '?', 'This removes it from your ship, and any public link stops working.', 'Delete').then(function (yes) {
      if (!yes) return;
      fetch(itemUrl(state.storeApp, it.path), { method: 'DELETE', credentials: 'same-origin' }).then(function (r) {
        return r.text().then(function () { return r; });
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        toast('Deleted ' + it.path);
        return loadStore();
      }).catch(function (e) { toast(e.message, true); });
    });
  }

  // ---------- shell ----------
  function route() {
    var tab = (location.hash.match(/^#\/(\w+)/) || [])[1] === 'storage' ? 'storage' : 'apps';
    document.querySelectorAll('.tabs a').forEach(function (a) {
      a.classList.toggle('active', a.dataset.tab === tab);
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $('#view-apps').hidden = tab !== 'apps';
    $('#view-storage').hidden = tab !== 'storage';
    if (tab === 'storage') loadStore().catch(function (e) { toast(e.message, true); });
  }
  function cycleTheme() {
    var cur = document.documentElement.dataset.theme || 'auto';
    var next = cur === 'auto' ? 'dark' : cur === 'dark' ? 'light' : 'auto';
    if (next === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try { if (next === 'auto') localStorage.removeItem('utilities-theme'); else localStorage.setItem('utilities-theme', next); } catch (e) { /* ignore */ }
    toast('Theme: ' + next);
  }

  $('#search').addEventListener('input', function (e) { state.query = e.target.value; renderCatalog(); });
  $('#theme').addEventListener('click', cycleTheme);
  $('#refresh').addEventListener('click', function () { loadStore().catch(function (e) { toast(e.message, true); }); });
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) loadCatalog().catch(function () {}); });

  fetch('/utilities/icons/index.json', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; })
    .then(function (list) { (list || []).forEach(function (f) { state.icons[f] = true; }); })
    .then(loadCatalog)
    .catch(function (e) { toast('Could not load the catalog: ' + e.message, true); });
  route();
})();
