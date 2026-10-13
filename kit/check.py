#!/usr/bin/env python3
"""Check a satellite desk is committable to Clay and fully served.

usage: kit/check.py <desk-dir>
- every path segment is a legal knot ([a-z0-9-._~], not empty, no leading '.')
- every file has an extension, and the extension has a mark in mar/
- reports total size and the largest files
"""
import os, re, sys

KNOT = re.compile(r'^[a-z0-9_~.-]+$')

def main(desk):
    web = os.path.join(desk, 'web')
    marks = {f[:-5] for f in os.listdir(os.path.join(desk, 'mar')) if f.endswith('.hoon')}
    bad, nomark, total, sizes = [], set(), 0, []
    for root, _, files in os.walk(web):
        for f in files:
            p = os.path.relpath(os.path.join(root, f), web)
            segs = p.split('/')
            if any(not KNOT.match(s) or s.startswith('.') for s in segs) or '.' not in segs[-1]:
                bad.append(p)
            else:
                ext = segs[-1].rsplit('.', 1)[1]
                if ext not in marks:
                    nomark.add(ext)
            sz = os.path.getsize(os.path.join(root, f))
            total += sz
            sizes.append((sz, p))
    ok = not bad and not nomark
    if bad:
        print(f'{len(bad)} paths are not clay-safe (lowercase [a-z0-9-._~], need an extension):')
        for p in bad[:40]:
            print('  ', p)
    if nomark:
        print('extensions without marks (run kit/marks.py):', ' '.join(sorted(nomark)))
    sizes.sort(reverse=True)
    print(f'{len(sizes)} files, {total/1e6:.1f} MB; largest:',
          ', '.join(f'{p} {s/1e6:.1f}MB' for s, p in sizes[:4]))
    print('OK' if ok else 'FAIL')
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main(sys.argv[1])
