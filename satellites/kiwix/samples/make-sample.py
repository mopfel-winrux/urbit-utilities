#!/usr/bin/env python3
"""Generate samples/urbit-sample.zim: a tiny ZIM written for this repo (CC0-1.0).
usage: python3 -m venv v && v/bin/pip install libzim==3.13.1 && v/bin/python make-sample.py
"""
import os
from libzim.writer import Creator, Item, StringProvider, Hint

PAGES = {
    'index': ('Urbit Kiwix Sample', '<h1>Urbit Kiwix Sample</h1><p>This tiny archive tests the Kiwix satellite.</p>'
              '<ul><li><a href="Moon">Moon</a></li><li><a href="Comet">Comet</a></li></ul>'),
    'Moon': ('Moon', '<h1>Moon</h1><p>The quick brown fox reads offline archives stored on a ship.</p>'
             '<p><a href="index">Back to the main page</a></p>'),
    'Comet': ('Comet', '<h1>Comet</h1><p>Comets are icy bodies that release gas near the Sun.</p>'),
}

class Page(Item):
    def __init__(self, path, title, body):
        super().__init__()
        self.p, self.t, self.b = path, title, body
    def get_path(self): return self.p
    def get_title(self): return self.t
    def get_mimetype(self): return 'text/html'
    def get_contentprovider(self):
        return StringProvider(f'<!DOCTYPE html><html><head><meta charset="utf-8"><title>{self.t}</title></head>'
                              f'<body>{self.b}</body></html>')
    def get_hints(self): return {Hint.FRONT_ARTICLE: True}

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'urbit-sample.zim')
if os.path.exists(out):
    os.remove(out)
with Creator(out).config_indexing(True, 'eng') as c:
    c.set_mainpath('index')
    for k, v in {'Name': 'urbit_sample', 'Title': 'Urbit Kiwix Sample', 'Creator': 'vert-urbit',
                 'Publisher': 'vert-urbit', 'Date': '2026-10-12', 'Description': 'Tiny test archive',
                 'Language': 'eng', 'License': 'CC0-1.0'}.items():
        c.add_metadata(k, v)
    for path, (title, body) in PAGES.items():
        c.add_item(Page(path, title, body))
print(out, os.path.getsize(out))
