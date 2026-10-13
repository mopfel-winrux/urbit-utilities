#!/usr/bin/env python3
"""Fetch every file of a satellite desk from a ship and compare sizes.

usage: tools/verify-served.py <base-url> <cookie> <desk> [<desk> ...]
Local names are clay-encoded (kit/claysafe.py); they are decoded back to the
original URL the app would request, which exercises the fileserver's +enc.
"""
import os, re, sys, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def dec(seg):
    seg = re.sub(r'~~([0-9a-f]{2})', lambda m: '%' + m.group(1), seg)
    seg = re.sub(r'~([a-z])', lambda m: m.group(1).upper(), seg)
    return seg  # percent-escapes for raw bytes stay escaped

def check(base, cookie, desk):
    web = os.path.join(ROOT, 'satellites', desk, 'desk', 'web') if desk != 'utilities' else os.path.join(ROOT, 'hub', 'desk', 'web')
    files = []
    for dp, _, fs in os.walk(web):
        for f in fs:
            rel = os.path.relpath(os.path.join(dp, f), web)
            files.append((rel, os.path.getsize(os.path.join(dp, f))))
    def one(item):
        rel, size = item
        url = f'{base}/{desk}/' + '/'.join(urllib.parse.quote(dec(s), safe='%~') for s in rel.split('/'))
        req = urllib.request.Request(url, headers={'Cookie': cookie})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                n = len(r.read())
                return None if n == size or rel.endswith(('.json', '.webmanifest', '.txt')) else f'{rel}: size {n} != {size}'
        except Exception as e:
            return f'{rel}: {e}'
    with ThreadPoolExecutor(8) as ex:
        bad = [b for b in ex.map(one, files) if b]
    print(f'{desk}: {len(files) - len(bad)}/{len(files)} ok' + ('' if not bad else '\n  ' + '\n  '.join(bad[:8])))
    return not bad

if __name__ == '__main__':
    base, cookie, desks = sys.argv[1], sys.argv[2], sys.argv[3:]
    sys.exit(0 if all([check(base, cookie, d) for d in desks]) else 1)
