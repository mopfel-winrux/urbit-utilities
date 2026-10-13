#!/usr/bin/env python3
"""Generate byte-exact (octs) marks for every file extension under <desk>/web.

usage: kit/marks.py <desk-dir>
Every web file is stored and served as raw bytes, so nothing is parsed or
re-serialized on commit (no json/txt/html normalization, no trailing-NUL loss).
Exits non-zero if an extension has no known MIME type: add it to MIME below.
"""
import os, sys

MIME = {
    'html': 'text/html', 'htm': 'text/html', 'css': 'text/css',
    'js': 'application/javascript', 'mjs': 'application/javascript',
    'cjs': 'application/javascript', 'json': 'application/json',
    'map': 'application/json', 'webmanifest': 'application/manifest+json',
    'ipynb': 'application/json', 'jsonl': 'application/jsonl',
    'txt': 'text/plain', 'md': 'text/markdown', 'csv': 'text/csv',
    'tsv': 'text/tab-separated-values', 'xml': 'application/xml',
    'xsl': 'application/xml', 'yaml': 'text/yaml', 'yml': 'text/yaml',
    'toml': 'text/plain', 'py': 'text/x-python', 'ts': 'text/plain',
    'svg': 'image/svg+xml', 'png': 'image/png', 'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp',
    'avif': 'image/avif', 'ico': 'image/x-icon', 'bmp': 'image/bmp',
    'cur': 'image/x-icon', 'wasm': 'application/wasm',
    'woff': 'font/woff', 'woff2': 'font/woff2', 'ttf': 'font/ttf',
    'otf': 'font/otf', 'eot': 'application/vnd.ms-fontobject',
    'mp3': 'audio/mpeg', 'ogg': 'audio/ogg', 'wav': 'audio/wav',
    'mp4': 'video/mp4', 'webm': 'video/webm', 'pdf': 'application/pdf',
    'zip': 'application/zip', 'gz': 'application/gzip', 'tgz': 'application/gzip',
    'tar': 'application/x-tar', 'whl': 'application/zip',
    'data': 'application/octet-stream', 'bin': 'application/octet-stream',
    'zim': 'application/octet-stream', 'mem': 'application/octet-stream',
    'jsdos': 'application/zip', 'pyc': 'application/octet-stream',
    'so': 'application/octet-stream', 'dat': 'application/octet-stream',
    'aff': 'text/plain', 'dic': 'text/plain', 'xcd': 'application/xml',
    'rdb': 'application/octet-stream', 'res': 'application/octet-stream',
    'metadata': 'application/json',
    'fnt': 'text/plain',
    'bcmap': 'application/octet-stream', 'ftl': 'text/plain',
    'icc': 'application/vnd.iccprofile', 'pfb': 'application/x-font-type1',
    'typ': 'text/plain',
    'db': 'application/vnd.sqlite3',
    'flf': 'text/plain',
}
# marks that must keep their real (non-octs) definitions in a desk
RESERVED = {'hoon', 'kelvin', 'bill', 'docket-0', 'mime', 'noun', 'txt'}  # hoon's grad uses the wain txt mark

TEMPLATE = """::  raw bytes served as {mime}
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/{a}/'{b}' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
"""

def main(desk):
    web = os.path.join(desk, 'web')
    exts = set()
    for root, _, files in os.walk(web):
        for f in files:
            if '.' in f:
                exts.add(f.rsplit('.', 1)[1])
    missing = sorted(e for e in exts if e not in MIME)
    if missing:
        print('no MIME type for extensions:', ' '.join(missing), '(add to kit/marks.py)')
        sys.exit(1)
    os.makedirs(os.path.join(desk, 'mar'), exist_ok=True)
    for e in sorted(exts - RESERVED):
        a, b = MIME[e].split('/', 1)
        with open(os.path.join(desk, 'mar', e + '.hoon'), 'w') as fh:
            fh.write(TEMPLATE.format(mime=MIME[e], a=a, b=b))
    print('marks:', ' '.join(sorted(exts)))

if __name__ == '__main__':
    main(sys.argv[1])
