// Launcher for js-dos on Urbit: load a .jsdos bundle or a .zip of a DOS program
// from the user's computer and run it with the vendored emulators (js-dos/emulators/).
// A plain .zip is turned into a .jsdos bundle in the browser by adding a
// .jsdos/dosbox.conf that mounts it as C: and runs the chosen program.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var fileIn = $('file'), run = $('run'), runrow = $('runrow'), start = $('start'), err = $('err'), backend = $('backend');
  var current = null; // { file, bytes, entries, isBundle }

  try { var b = localStorage.getItem('jsdos-launcher-backend'); if (b) backend.value = b; } catch (e) {}

  // --- minimal zip reader/writer (central directory only; data is copied as is) ---
  var u16 = function (d, o) { return d[o] | d[o + 1] << 8; };
  var u32 = function (d, o) { return (d[o] | d[o + 1] << 8 | d[o + 2] << 16 | d[o + 3] << 24) >>> 0; };
  function readZip(d) {
    var eocd = -1;
    for (var i = d.length - 22; i >= Math.max(0, d.length - 22 - 65535); i--) {
      if (u32(d, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip file');
    var n = u16(d, eocd + 10), cdSize = u32(d, eocd + 12), cdOff = u32(d, eocd + 16);
    if (n === 0xffff || cdOff === 0xffffffff) throw new Error('zip64 archives are not supported');
    var entries = [], p = cdOff;
    for (var k = 0; k < n; k++) {
      if (u32(d, p) !== 0x02014b50) throw new Error('corrupt zip central directory');
      var nl = u16(d, p + 28), xl = u16(d, p + 30), cl = u16(d, p + 32);
      var name = new TextDecoder().decode(d.subarray(p + 46, p + 46 + nl));
      entries.push({ name: name, cd: d.subarray(p, p + 46 + nl + xl + cl), local: u32(d, p + 42) });
      p += 46 + nl + xl + cl;
    }
    return { entries: entries, cdOff: cdOff, cdSize: cdSize };
  }
  var crcTable = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(d) { var c = 0xffffffff; for (var i = 0; i < d.length; i++) c = crcTable[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  // returns a new zip: every entry of `d` (byte-for-byte) plus a stored file `name`
  function addFile(d, zip, name, data) {
    var nameB = new TextEncoder().encode(name), crc = crc32(data);
    var body = d.subarray(0, zip.cdOff); // all local entries, in order
    var lh = new Uint8Array(30 + nameB.length), lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameB.length, true); lh.set(nameB, 30);
    var newOff = body.length;
    var ch = new Uint8Array(46 + nameB.length), cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameB.length, true); cv.setUint32(42, newOff, true); ch.set(nameB, 46);
    var cdLen = zip.cdSize + ch.length, cdStart = newOff + lh.length + data.length;
    var out = new Uint8Array(cdStart + cdLen + 22), o = 0;
    out.set(body, o); o += body.length; out.set(lh, o); o += lh.length; out.set(data, o); o += data.length;
    zip.entries.forEach(function (e) { out.set(e.cd, o); o += e.cd.length; });
    out.set(ch, o); o += ch.length;
    var ev = new DataView(out.buffer, o);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, zip.entries.length + 1, true); ev.setUint16(10, zip.entries.length + 1, true);
    ev.setUint32(12, cdLen, true); ev.setUint32(16, cdStart, true);
    return out;
  }

  function executables(entries) {
    return entries.map(function (e) { return e.name; })
      .filter(function (n) { return /\.(exe|com|bat)$/i.test(n) && n.indexOf('__MACOSX') < 0; })
      .sort(function (a, b) {
        var da = a.split('/').length, db = b.split('/').length;
        var sa = /(setup|install|config|setsound|uninst)/i.test(a), sb = /(setup|install|config|setsound|uninst)/i.test(b);
        return da - db || sa - sb || a.localeCompare(b);
      });
  }

  fileIn.addEventListener('change', function () {
    err.textContent = ''; start.disabled = true; runrow.hidden = true; current = null;
    var f = fileIn.files[0];
    if (!f) return;
    f.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf), zip = readZip(bytes);
      var isBundle = zip.entries.some(function (e) { return e.name === '.jsdos/dosbox.conf'; });
      current = { file: f, bytes: bytes, zip: zip, isBundle: isBundle };
      if (!isBundle) {
        run.innerHTML = '';
        executables(zip.entries).forEach(function (n) {
          var o = document.createElement('option'); o.value = n; o.textContent = n; run.appendChild(o);
        });
        var none = document.createElement('option'); none.value = ''; none.textContent = '(nothing, DOS prompt)';
        run.appendChild(none);
        runrow.hidden = false;
      }
      start.disabled = false;
    }).catch(function (e) { err.textContent = 'Cannot read ' + f.name + ': ' + e.message; });
  });

  function dosboxConf(target) {
    var lines = ['[sdl]', 'autolock=false', '', '[cpu]', 'core=auto', 'cputype=auto', 'cycles=auto', '', '[autoexec]', 'echo off', 'mount c .', 'c:'];
    if (target) {
      var parts = target.split('/'), exe = parts.pop();
      if (parts.length) lines.push('cd \\' + parts.join('\\'));
      lines.push((/\.bat$/i.test(exe) ? 'call ' : '') + exe);
    }
    return lines.join('\n') + '\n';
  }

  start.addEventListener('click', function () {
    if (!current) return;
    var bytes = current.bytes;
    if (!current.isBundle) {
      try {
        bytes = addFile(bytes, current.zip, '.jsdos/dosbox.conf', new TextEncoder().encode(dosboxConf(run.value)));
      } catch (e) { err.textContent = e.message; return; }
    }
    try { localStorage.setItem('jsdos-launcher-backend', backend.value); } catch (e) {}
    var name = current.file.name;
    $('title').textContent = name + (current.isBundle ? '' : (run.value ? ' — ' + run.value : ''));
    document.body.classList.add('playing');
    var url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    window.dosInstance = window.Dos($('dos'), {
      url: url,
      pathPrefix: new URL('js-dos/emulators/', location.href).href,
      backend: backend.value,
      autoStart: true,
      // saved changes are kept in the browser (OPFS), keyed by file name rather than the blob URL
      fsChanges: { urlToKey: function () { return 'local/' + name + (current.isBundle ? '' : '/' + run.value) + '.changes'; } },
    });
  });
  $('back').addEventListener('click', function () { location.reload(); });
})();
