#!/usr/bin/env python3
"""Make EmulatorJS 4.2.3 fully offline: no update check, no CDN core fallback,
no default netplay server. Exact replacements; fails loudly if upstream changed.
usage: offline.py <data/src/emulator.js>"""
import sys
p = sys.argv[1]
s = open(p).read()
R = [
    # update check against cdn.emulatorjs.org (runs on localhost or in debug mode)
    ('if (this.debug || (window.location && ["localhost", "127.0.0.1"].includes(location.hostname))) this.checkForUpdates();',
     '/* urbit: update check removed (no external requests) */'),
    # CDN fallback when a core is not vendored: fail instead of fetching it
    ('res = await this.downloadFile(`https://cdn.emulatorjs.org/${version}/data/${corePath}`, (progress) => {\n                    this.textElem.innerText = this.localization("Download Game Core") + progress;\n                }, true, { responseType: "arraybuffer", method: "GET" });',
     'res = -1; /* urbit: no CDN fallback, this core is not vendored in the desk */'),
    # default netplay server
    ('this.config.netplayUrl = this.config.netplayUrl || "https://netplay.emulatorjs.org";',
     'this.config.netplayUrl = this.config.netplayUrl || "";'),
]
for a, b in R:
    if a in s:
        s = s.replace(a, b)
    elif b not in s:
        sys.exit(f'offline.py: pattern not found: {a[:60]}')
open(p, 'w').write(s)
