#!/usr/bin/env python3
"""Rename files under <web-dir> to clay-safe names, in place.

usage: kit/claysafe.py <desk>/web
Mirrors +enc in the kit fileserver, which applies the same encoding to request
URLs, so the app keeps using its original file names and nothing is rewritten:
  a-z 0-9 - . _  stay;  A-Z -> '~' + lowercase;  any other byte -> '~~' + 2 hex
Directory names are encoded whole; for files the base name is encoded and the
extension lowercased. Already-safe names are unchanged.
"""
import os, sys

def enc(seg):
    out = []
    for b in seg.encode('utf-8'):
        c = chr(b)
        if 'a' <= c <= 'z' or '0' <= c <= '9' or c in '-._':
            out.append(c)
        elif 'A' <= c <= 'Z':
            out.append('~' + c.lower())
        else:
            out.append('~~%02x' % b)
    return ''.join(out)

def enc_file(name):
    if '.' not in name.lstrip('.'):
        return None
    base, ext = name.rsplit('.', 1)
    return enc(base) + '.' + ext.lower()

def main(web):
    renamed, skipped = 0, []
    for root, dirs, files in os.walk(web, topdown=False):
        for f in files:
            new = enc_file(f)
            if new is None:
                skipped.append(os.path.relpath(os.path.join(root, f), web))
                continue
            if new != f:
                dst = os.path.join(root, new)
                if os.path.exists(dst):
                    sys.exit(f'collision: {f} -> {new} in {root}')
                os.rename(os.path.join(root, f), dst)
                renamed += 1
        if root != web:
            parent, d = os.path.split(root)
            new = enc(d)
            if new != d:
                if os.path.exists(os.path.join(parent, new)):
                    sys.exit(f'collision: dir {d} -> {new} in {parent}')
                os.rename(root, os.path.join(parent, new))
                renamed += 1
    print(f'claysafe: renamed {renamed}')
    if skipped:
        print(f'claysafe: {len(skipped)} files without an extension (not servable, remove or rename):')
        for p in skipped[:20]:
            print('  ', p)

if __name__ == '__main__':
    main(sys.argv[1])
