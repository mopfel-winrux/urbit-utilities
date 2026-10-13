#!/usr/bin/env python3
"""Patch a pristine kiwix-js 4.4.0 source tree for the %kiwix satellite.
usage: patch.py <kiwix-js-src-dir>   (run on a freshly extracted tree; every edit must apply exactly once)
"""
import os, sys

SRC = sys.argv[1]


def sub(rel, old, new, count=1):
    p = os.path.join(SRC, rel)
    s = open(p, encoding='utf-8').read()
    n = s.count(old)
    if n != count:
        sys.exit(f'patch: {rel}: expected {count} match(es) of {old[:70]!r}, found {n}')
    open(p, 'w', encoding='utf-8').write(s.replace(old, new))


SELF_CSP = "default-src 'self' data: blob: about: 'unsafe-inline' 'unsafe-eval'"

# 1. No external requests: lock the app CSP to same-origin (drops *.kiwix.org, kiwix.github.io, ftp.fau.de)
sub('www/index.html',
    "content=\"default-src 'self' data: file: blob: about: https://*.kiwix.org https://master.download.kiwix.org "
    "https://browse.library.kiwix.org https://kiwix.github.io 'unsafe-inline' 'unsafe-eval'; img-src 'self' data: file: "
    "blob: about: https://*.kiwix.org https://master.download.kiwix.org https://browse.library.kiwix.org "
    "https://kiwix.github.io https://ftp.fau.de; frame-src 'self' moz-extension: chrome-extension:; object-src 'none';\"",
    f"content=\"{SELF_CSP}; frame-src 'self'; object-src 'none';\"")
# ... and the CSP injected into articles (jQuery/Restricted mode)
sub('www/js/app.js',
    "content=\"default-src \\'self\\' data: file: blob: about: chrome-extension: moz-extension: "
    "https://browser-extension.kiwix.org https://kiwix.github.io \\'unsafe-inline\\' \\'unsafe-eval\\';\"",
    "content=\"default-src \\'self\\' data: blob: about: \\'unsafe-inline\\' \\'unsafe-eval\\';\"")
# library.html would load the online ZIM catalogue in an iframe
sub('www/library.html', "default-src 'self' data: * 'unsafe-inline' 'unsafe-eval'; frame-src 'self' moz-extension: chrome-extension: *;",
    f"{SELF_CSP}; frame-src 'self';")
# 2. Disable the online ZIM library (download catalogue, mirror probe) and the extension PWA server
for key in ('libraryUrl', 'altLibraryUrl', 'altLibraryProbe', 'PWAServer'):
    p = os.path.join(SRC, 'www/js/init.js')
    s = open(p, encoding='utf-8').read()
    i = s.index(f"params['{key}'] = '")
    j = s.index("';", i + len(key) + 12)
    open(p, 'w', encoding='utf-8').write(s[:i] + f"params['{key}'] = 'about:blank" + s[j:])
sub('www/js/init.js', "params['kiwixDownloadMirrors'] = [", "params['kiwixDownloadMirrors'] = []; void [")
sub('www/js/app.js', "    kiwixLibrary.loadLibrary(libraryIframe);\n",
    "    // urbit: the online library is disabled (no external requests)\n    void libraryIframe;\n")
sub('www/index.html', 'class="btn btn-light custom-file-upload" id="btnLibrary"',
    'class="btn btn-light custom-file-upload" id="btnLibrary" style="display: none !important;"')

# 3. Expose the archive loader so ship.js can open a File fetched from the ship
sub('www/js/app.js', "window.setLocalArchiveFromFileSelect = setLocalArchiveFromFileSelect;\n",
    "window.setLocalArchiveFromFileSelect = setLocalArchiveFromFileSelect;\n"
    "window.setLocalArchiveFromFileList = setLocalArchiveFromFileList;\n")

# 4. Ship storage panel in Configuration, and its script
PANEL = '''<div id="shipStore" class="card" style="margin: 0.5em 0 1em 0;">
                            <div class="card-body">
                                <h4 class="card-title">ZIM archives on your ship</h4>
                                <ul id="shipZimList" class="list-group" style="margin-bottom: 0.5em;"></ul>
                                <label class="btn btn-light custom-file-upload" id="shipUploadLbl" title="Copy a .zim file from this computer to your ship">
                                    <input type="file" id="shipUploadInput" accept=".zim" multiple style="display: none;" />
                                    <span>Upload ZIM to ship</span>
                                </label>
                                <button type="button" class="btn btn-light" id="shipRefresh">Refresh</button>
                                <p id="shipStatus" style="margin: 0.5em 0 0 0;" aria-live="polite"></p>
                            </div>
                        </div>
                        <div id="selectorsDisplay" style="display: none;">'''
sub('www/index.html', '<div id="selectorsDisplay" style="display: none;">', PANEL)
sub('www/index.html', '<!-- <script type="text/javascript" defer src="js/bundle.js"></script> -->',
    '<!-- <script type="text/javascript" defer src="js/bundle.js"></script> -->\n    <script type="text/javascript" defer src="js/ship.js"></script>')

# 5. Service worker: never cache a redirected response (e.g. a login redirect when the session expired)
sub('service-worker.js', "if (!response.ok) throw Error('Could not fetch ' + request.url);",
    "if (!response.ok || response.redirected) throw Error('Could not fetch ' + request.url);")
sub('service-worker.js', "    if (!response.ok || !(useAppCache",
    "    if (!response.ok || response.redirected || !(useAppCache")
# precache our script too
sub('service-worker.js', "    'www/js/init.js',\n", "    'www/js/init.js',\n    'www/js/ship.js',\n")
# the deployed web root has manifest.webmanifest (extension manifests and the css sourcemap are not shipped)
sub('service-worker.js', "    'manifest.json',\n", "    'manifest.webmanifest',\n")
sub('service-worker.js', ",\n    'node_modules/bootstrap/dist/css/bootstrap.min.css.map'", "")
print('patch: ok')
