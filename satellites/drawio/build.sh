#!/bin/bash
# Package draw.io (https://github.com/jgraph/drawio) for /drawio into desk/web.
# Uses the prebuilt static app committed at the release tag
# (src/main/webapp: app.min.js etc. are built by jgraph for each release),
# configured for fully offline use (patches/PreConfig.js, PostConfig.js) and
# trimmed of server, integration and dev-only files.
set -e
HERE=$(cd "$(dirname "$0")" && pwd); KIT="$HERE/../../kit"
TAG=v32.4.1; COMMIT=9034053fba80a435e27d68d374bc564b83917ae9
[ -d "$HERE/upstream/.git" ] || git clone -q --depth 1 -b $TAG https://github.com/jgraph/drawio "$HERE/upstream"
cd "$HERE/upstream"
[ "$(git rev-parse HEAD)" = $COMMIT ] || { echo "upstream is not $TAG ($COMMIT)"; exit 1; }
git checkout -q -- .
W="$HERE/desk/web"; rm -rf "$W"; cp -r src/main/webapp "$W"; cd "$W"
# server side, integrations (Confluence/Jira/Teams/monday/cloud pickers), plugins, dev sources
rm -rf WEB-INF META-INF connect plugins js/diagramly js/grapheditor js/onedrive js/dropbox js/simplepeer
rm -f teams.html dropbox.html github.html gitlab.html onedrive3.html export3.html vsdxImporter.html \
  monday-app-association.json js/integrate.min.js js/viewer.min.js js/viewer-static.min.js \
  js/embed.dev.js js/export.js js/export-init.js js/vsdxImporter.js workbox-*.js
find . \( -name '*.map' -o -name 'CLAUDE.md' -o -name '*.md' -o -name '.*' \) -type f -delete
# extensionless files can't be served; keep the license texts as .txt
find . -type f -name LICENSE -exec mv {} {}.txt \;
cp "$HERE/patches/PreConfig.js" js/PreConfig.js
cp "$HERE/patches/PostConfig.js" js/PostConfig.js
# page metadata pointing at diagrams.net (not fetched, but not ours either)
sed -i -E '/<meta itemprop="image"/d; /<link rel="canonical"/d' index.html
python3 - <<'PY'
# keep the precache manifest in step with the trimmed tree (missing entries fail the install)
import os, re
s = open('service-worker.js').read()
def keep(m):
    lines = [l for l in m.group(1).split('\n') if l.strip()]
    kept = [l.rstrip(',') for l in lines if os.path.isfile(re.search(r'"url":"([^"]*)"', l).group(1))]
    return m.group(0).replace(m.group(1), '\n' + ',\n'.join(kept) + '\n')
s = re.sub(r'var (?:MANIFEST|LAZY_MANIFEST) = \[(.*?)\];', keep, s, flags=re.S)
s = s.replace('\n//# sourceMappingURL=service-worker.js.map', '')
open('service-worker.js', 'w').write(s)
PY
# icon: the draw.io logo
cp images/drawlogo.svg icon.svg
python3 "$KIT/pwa.py" "$HERE/desk" --theme "#f08705"
python3 "$KIT/claysafe.py" "$W"
python3 "$KIT/marks.py" "$HERE/desk" && python3 "$KIT/check.py" "$HERE/desk"
