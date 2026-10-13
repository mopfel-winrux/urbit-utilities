#!/usr/bin/env python3
"""Remove js-dos 8.5.3's automatic external requests. Exact replacements that fail
loudly if upstream changed. usage: offline.py <dist/js-dos.js>"""
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
R = [
    # Dhrystone benchmark result upload (runs when the dhry2 bundle finishes)
    ('await fetch("https://d5dn8hh4ivlobv6682ep.apigw.yandexcloud.net/perf/set",{method:"POST",body:JSON.stringify(t)})',
     'void t'),
    # default emulators location: the vendored copy next to js-dos.js instead of v8.js-dos.com
    ('t.pathPrefix??"https://v8.js-dos.com/latest/emulators/"',
     't.pathPrefix??new URL("emulators/",import.meta.url).href'),
]
for a, b in R:
    n = s.count(a)
    if n == 1:
        s = s.replace(a, b)
    elif not (n == 0 and b in s):
        sys.exit(f'offline.py: expected 1 match, found {n}: {a[:70]}')
open(p, 'w', encoding='utf-8').write(s)
