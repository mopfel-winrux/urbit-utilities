#!/usr/bin/env python3
"""Make a satellite installable as a PWA scoped to its web root (/<desk>/).

usage: kit/pwa.py <desk-dir> [--name "Full Name"] [--short "Short"] [--theme "#hex"] [--bg "#hex"]

Run it after the app is copied into <desk>/web and before claysafe/marks/check.
- icons: needs web/icon.svg or web/icon.png. Writes icon-192.png and icon-512.png
  (SVG is rasterized with headless Chrome, PNG resized with Pillow).
- manifest: if index.html already links one, it is rewritten so that start_url,
  scope and id resolve to /<desk>/ and the 192/512 icons are present. Otherwise
  web/manifest.webmanifest is created and linked.
  The <link rel="manifest"> gets crossorigin="use-credentials", because the
  fileserver requires the login cookie and browsers fetch manifests without
  credentials by default (403).
- service worker: if the app registers no service worker of its own, kit's
  pwa-sw.js is copied to web/sw.js (scope /<desk>/) and registered from
  index.html. An app's own worker is kept; check that its scope is under /<desk>/.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tempfile

KIT = os.path.dirname(os.path.abspath(__file__))
CHROME = os.environ.get('CHROME', os.path.expanduser(
    '~/.cache/puppeteer/chrome/linux-154.0.8037.57/chrome-linux64/chrome'))


def desk_name(desk):
    cfg = open(os.path.join(desk, 'app', 'fileserver', 'config.hoon')).read()
    return re.search(r'\+\+\s+web-root\s+\^-\s+\(list @t\)\s+/([a-z0-9-]+)', cfg).group(1)


def catalog_title(name):
    """The app's title from catalog.json (used when the manifest has no name)."""
    try:
        apps = json.load(open(os.path.join(os.path.dirname(KIT), 'catalog.json')))
    except (OSError, ValueError):
        return None
    return next((a.get('title') for a in apps if a.get('desk') == name), None)


def make_icons(web):
    svg, png = os.path.join(web, 'icon.svg'), os.path.join(web, 'icon.png')
    for size in (192, 512):
        out = os.path.join(web, f'icon-{size}.png')
        if os.path.exists(out):
            continue
        if os.path.exists(svg):
            with tempfile.TemporaryDirectory() as tmp:
                page = os.path.join(tmp, 'icon.html')
                with open(page, 'w') as f:
                    f.write('<html><body style="margin:0;background:transparent">'
                            f'<img src="file://{svg}" style="width:{size}px;height:{size}px;display:block">'
                            '</body></html>')
                subprocess.run([CHROME, '--headless', '--no-sandbox', '--disable-gpu',
                                '--hide-scrollbars', '--default-background-color=00000000',
                                f'--window-size={size},{size}', f'--screenshot={out}', page],
                               check=True, capture_output=True)
        elif os.path.exists(png):
            from PIL import Image
            Image.open(png).convert('RGBA').resize((size, size), Image.LANCZOS).save(out)
        else:
            sys.exit('pwa: need web/icon.svg or web/icon.png')


def rel_to_root(manifest_rel):
    depth = manifest_rel.count('/')
    return './' if depth == 0 else '../' * depth


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('desk')
    ap.add_argument('--name')
    ap.add_argument('--short')
    ap.add_argument('--theme', default='#ffffff')
    ap.add_argument('--bg', default='#ffffff')
    a = ap.parse_args()

    desk = a.desk.rstrip('/')
    web = os.path.join(desk, 'web')
    name = desk_name(desk)
    root = f'/{name}/'
    title = a.name or catalog_title(name) or name
    short = a.short or title[:12]
    index_path = os.path.join(web, 'index.html')
    html = open(index_path, encoding='utf-8').read()

    make_icons(web)

    live = re.sub(r'<!--.*?-->', '', html, flags=re.S)  # ignore commented-out links
    link = re.search(r'<link[^>]*rel=["\']?manifest["\']?[^>]*>', live, re.I)
    if link:
        href = re.search(r'href=["\']?([^"\'\s>]+)', link.group(0)).group(1)
        # resolve the manifest file relative to the web root
        rel = href[len(root):] if href.startswith(root) else href.lstrip('./') if not href.startswith('/') else None
        if rel is None:
            sys.exit(f'pwa: manifest href {href} is outside {root}; fix the app base path first')
        mpath = os.path.join(web, rel)
        man = json.load(open(mpath, encoding='utf-8'))
        back = rel_to_root(rel)
        icon_prefix = back
        tag = link.group(0)
        if 'crossorigin' not in tag:
            html = html.replace(tag, tag[:-1].rstrip('/').rstrip() + ' crossorigin="use-credentials">', 1)
    else:
        rel = 'manifest.webmanifest'
        mpath = os.path.join(web, rel)
        man = {'name': title, 'short_name': short, 'display': 'standalone',
               'background_color': a.bg, 'theme_color': a.theme}
        back = icon_prefix = './'
        html = re.sub(r'</head>', f'<link rel="manifest" href="{root}{rel}" crossorigin="use-credentials">\n</head>',
                      html, count=1, flags=re.I)

    # blank names fail installability; fill them from the catalog title
    if not (man.get('name') or '').strip():
        man['name'] = title
    if not (man.get('short_name') or '').strip():
        man['short_name'] = short
    man['start_url'] = back
    man['scope'] = back
    man['id'] = back
    # drop remote icons and root-absolute ones outside /<desk>/ (they 404 under the desk)
    icons = [i for i in man.get('icons', [])
             if not i.get('src', '').startswith(('http:', 'https:', '//'))
             and not (i.get('src', '').startswith('/') and not i['src'].startswith(root))]
    # installability needs png icons with purpose "any" (the default); maskable-only doesn't count
    have = {i.get('sizes') for i in icons
            if i.get('type', 'image/png') == 'image/png' and 'any' in i.get('purpose', 'any').split()}
    for size in (192, 512):
        if f'{size}x{size}' not in have:
            icons.append({'src': f'{icon_prefix}icon-{size}.png', 'sizes': f'{size}x{size}',
                          'type': 'image/png', 'purpose': 'any'})
    man['icons'] = icons
    man.setdefault('display', 'standalone')
    with open(mpath, 'w', encoding='utf-8') as f:
        json.dump(man, f, indent=1)

    # service worker: keep the app's own, otherwise install the kit's
    has_sw = False
    for dp, _, files in os.walk(web):
        for fn in files:
            if fn.endswith(('.js', '.html', '.mjs')):
                try:
                    src = open(os.path.join(dp, fn), encoding='utf-8', errors='ignore').read()
                    src = re.sub(r'<!-- kit:pwa-sw --><script>.*?</script>', '', src, flags=re.S)  # ours, from a previous run
                    if 'serviceWorker.register' in src:
                        has_sw = True
                        break
                except OSError:
                    pass
        if has_sw:
            break
    if not has_sw:
        version = hashlib.sha1(html.encode()).hexdigest()[:12]
        sw = open(os.path.join(KIT, 'pwa-sw.js'), encoding='utf-8').read().replace('__VERSION__', version)
        with open(os.path.join(web, 'sw.js'), 'w', encoding='utf-8') as f:
            f.write(sw)
        reg = (f'<script>if("serviceWorker" in navigator)addEventListener("load",function(){{'
               f'navigator.serviceWorker.register("{root}sw.js",{{scope:"{root}"}}).catch(function(){{}})}})</script>')
        if 'kit:pwa-sw' not in html:
            html = re.sub(r'</head>', f'<!-- kit:pwa-sw -->{reg}\n</head>', html, count=1, flags=re.I)

    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(html)
    # prerendered pages (edit/index.html, 404.html, ...) link the manifest too
    for dp, _, files in os.walk(web):
        for fn in files:
            fp = os.path.join(dp, fn)
            if fn.endswith('.html') and fp != index_path:
                other = open(fp, encoding='utf-8', errors='surrogateescape').read()
                fixed = re.sub(r'<link[^>]*rel=["\']?manifest["\']?[^>]*>',
                               lambda m: m.group(0) if 'crossorigin' in m.group(0) else
                               m.group(0)[:-1].rstrip('/').rstrip() + ' crossorigin="use-credentials">',
                               other, flags=re.I)
                if fixed != other:
                    with open(fp, 'w', encoding='utf-8', errors='surrogateescape') as f:
                        f.write(fixed)
    print(f'pwa: {name} manifest={rel} start_url/scope={back} '
          f'sw={"app" if has_sw else "kit"} icons=192,512')


if __name__ == '__main__':
    main()
