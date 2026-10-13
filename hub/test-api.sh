#!/bin/bash
# Contract tests for the %utilities hub API (kit/CONTRACT.md).
# usage: hub/test-api.sh BASE_URL COOKIE
#   BASE_URL  e.g. http://localhost:8098 (ship) or http://localhost:8210 (mock)
#   COOKIE    e.g. "urbauth-~nus=0v..." (the mock accepts any urbauth-~nus=...)
# Uses a fresh app namespace per run, so it can be re-run against a live ship.
set -u
BASE=${1:?usage: test-api.sh BASE_URL COOKIE}; BASE=${BASE%/}
COOKIE=${2:?usage: test-api.sh BASE_URL COOKIE}
APP="t$(date +%s)-$RANDOM"; export APP
API="$BASE/utilities/api"; DAV="$BASE/utilities/dav/$APP"; PUB="$BASE/utilities/pub/$APP"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1${2:+  ($2)}"; }
eq()   { if [ "$2" == "$3" ]; then ok "$1"; else bad "$1" "want [$3] got [$2]"; fi; }
has()  { if grep -qiF -- "$3" <<<"$2"; then ok "$1"; else bad "$1" "missing [$3]"; fi; }
hasnt(){ if grep -qiF -- "$3" <<<"$2"; then bad "$1" "unexpected [$3]"; else ok "$1"; fi; }
# req: curl with cookie; writes body to $TMP/b and headers to $TMP/h, prints the status
req()  { curl -s -o "$TMP/b" -D "$TMP/h" -w '%{http_code}' -H "Cookie: $COOKIE" "$@"; }
anon() { curl -s -o "$TMP/b" -D "$TMP/h" -w '%{http_code}' "$@"; }
body() { cat "$TMP/b"; }
hdr()  { grep -i "^$1:" "$TMP/h" | head -1 | cut -d' ' -f2- | tr -d '\r'; }
py()   { python3 -c "$1" "$TMP/b"; }

echo "== $BASE  app=$APP"

echo "-- auth"
eq "api catalog without cookie is 401" "$(anon "$API/catalog")" 401
eq "api store without cookie is 401" "$(anon "$API/store/$APP/")" 401
eq "api PUT without cookie is 401" "$(anon -X PUT --data-binary x -H 'content-type: text/plain' "$API/store/$APP/x.txt")" 401
eq "dav OPTIONS without cookie is 401" "$(anon -X OPTIONS "$DAV/")" 401
has "dav 401 asks for basic auth" "$(cat "$TMP/h")" 'www-authenticate'
eq "dav PROPFIND without cookie is 401" "$(anon -X POST -H 'X-HTTP-Method-Override: PROPFIND' "$DAV/")" 401
eq "pub of a missing item is 404" "$(anon "$PUB/nothing.txt")" 404
eq "hub UI without cookie is 403" "$(anon "$BASE/utilities/")" 403
eq "hub UI with cookie is 200" "$(req "$BASE/utilities/")" 200

echo "-- catalog"
eq "GET catalog" "$(req "$API/catalog")" 200
has "catalog is json" "$(hdr content-type)" 'application/json'
eq "catalog shape" "$(py '
import json,sys
d=json.load(open(sys.argv[1])); apps=d["apps"]
assert isinstance(d["publisher"],str) and d["publisher"].startswith("~"), "publisher"
assert len(apps)>0, "no apps"
for a in apps:
    for k in ("desk","title","info","category","tier","href","status"): assert k in a,(a.get("desk"),k)
    assert a["href"]=="/%s/"%a["desk"], a["href"]
    assert a["status"] in ("installed","installing","suspended","available"), a["status"]
    assert a["tier"] in (1,2), a["tier"]
print("ok")' 2>&1)" ok
if [ -f "$(dirname "$0")/../catalog.json" ]; then
  eq "catalog lists every catalog.json desk" "$(python3 -c '
import json,sys
want=[a["desk"] for a in json.load(open(sys.argv[2]))]
got=[a["desk"] for a in json.load(open(sys.argv[1]))["apps"]]
print("ok" if want==got else "%s != %s"%(want,got))' "$TMP/b" "$(dirname "$0")/../catalog.json")" ok
fi
ORIG_PUB=$(py 'import json,sys;print(json.load(open(sys.argv[1]))["publisher"])')
eq "catalog HEAD/POST is not catalog (POST 404/405)" "$(req -X POST "$API/catalog" | sed 's/405/404/')" 404

echo "-- publisher"
eq "set publisher ~zod" "$(req -X POST -H 'content-type: application/json' -d '{"ship":"~zod"}' "$API/publisher")" 200
eq "publisher echoed" "$(py 'import json,sys;print(json.load(open(sys.argv[1]))["publisher"])')" '~zod'
req "$API/catalog" >/dev/null
eq "catalog uses override" "$(py 'import json,sys;print(json.load(open(sys.argv[1]))["publisher"])')" '~zod'
eq "bad ship is 400" "$(req -X POST -H 'content-type: application/json' -d '{"ship":"zod!"}' "$API/publisher")" 400
eq "reset publisher" "$(req -X POST -H 'content-type: application/json' -d '{"ship":null}' "$API/publisher")" 200
eq "publisher back to default" "$(py 'import json,sys;print(json.load(open(sys.argv[1]))["publisher"])')" "$ORIG_PUB"

echo "-- install/uninstall validation"
eq "install bad desk is 400" "$(req -X POST -H 'content-type: application/json' -d '{"desk":"Bad Desk"}' "$API/install")" 400
eq "install unknown desk is 400" "$(req -X POST -H 'content-type: application/json' -d '{"desk":"no-such-app-xyz"}' "$API/install")" 400
eq "uninstall unknown desk is 400" "$(req -X POST -H 'content-type: application/json' -d '{"desk":"no-such-app-xyz"}' "$API/uninstall")" 400
eq "install without body is 400" "$(req -X POST "$API/install")" 400

echo "-- store"
eq "empty list" "$(req "$API/store/$APP/")" 200
eq "empty list is []" "$(body)" "[]"
eq "PUT text" "$(req -X PUT -H 'content-type: text/plain;charset=utf-8' --data-binary 'hello world' "$API/store/$APP/notes/hello.txt")" 200
eq "PUT result" "$(py 'import json,sys;d=json.load(open(sys.argv[1]));print(d["path"],d["public_url"])')" "notes/hello.txt None"
eq "GET text" "$(req "$API/store/$APP/notes/hello.txt")" 200
eq "GET body" "$(body)" "hello world"
eq "GET content-type is the stored one" "$(hdr content-type)" "text/plain;charset=utf-8"
eq "HEAD" "$(req -I "$API/store/$APP/notes/hello.txt")" 200
eq "HEAD content-type" "$(hdr content-type)" "text/plain;charset=utf-8"
eq "PUT default type" "$(req -X PUT -H 'content-type:' --data-binary 'xyz' "$API/store/$APP/raw.bin")" 200
req "$API/store/$APP/raw.bin" >/dev/null
eq "default type is octet-stream" "$(hdr content-type)" "application/octet-stream"
eq "PUT encoded path" "$(req -X PUT -H 'content-type: text/plain' --data-binary 'sp' "$API/store/$APP/a%20dir/%C3%A9t%C3%A9%20%2B1.txt")" 200
eq "encoded path decoded" "$(py 'import json,sys;print(json.load(open(sys.argv[1]))["path"])')" "a dir/été +1.txt"
eq "GET encoded path" "$(req "$API/store/$APP/a%20dir/%C3%A9t%C3%A9%20%2B1.txt")" 200
eq "list" "$(req "$API/store/$APP/")" 200
eq "list rows" "$(py '
import json,sys
rows=json.load(open(sys.argv[1]))
print(" | ".join("%s %s %d %s %s %s %s"%(r["path"],r["type"],r["size"],r["public"],r["burn"],r["expires"],type(r["modified"]).__name__) for r in rows))')" \
  "a dir/été +1.txt text/plain 2 False False None int | notes/hello.txt text/plain;charset=utf-8 11 False False None int | raw.bin application/octet-stream 3 False False None int"
eq "list ?prefix=" "$(req "$API/store/$APP/?prefix=notes/")" 200
eq "prefix filters" "$(py 'import json,sys;print([r["path"] for r in json.load(open(sys.argv[1]))])')" "['notes/hello.txt']"
eq "modified is recent unix ms" "$(py 'import json,sys,time;print(abs(json.load(open(sys.argv[1]))[0]["modified"]-time.time()*1000)<600000)')" True
eq "overwrite" "$(req -X PUT -H 'content-type: text/markdown' --data-binary '# hi' "$API/store/$APP/notes/hello.txt")" 200
req "$API/store/$APP/notes/hello.txt" >/dev/null
eq "overwrite visible" "$(body) $(hdr content-type)" "# hi text/markdown"
eq "GET missing is 404" "$(req "$API/store/$APP/nope.txt")" 404
eq "PUT without path is 400" "$(req -X PUT --data-binary x "$API/store/$APP/")" 400
eq "store without trailing slash is 404" "$(req "$API/store/$APP")" 404
eq "bad app name is 404" "$(req "$API/store/Bad_App/x")" 404
eq "app summary" "$(req "$API/store/")" 200
eq "app summary row" "$(py 'import json,sys,os;r=[a for a in json.load(open(sys.argv[1])) if a["app"]==os.environ["APP"]];print(r and (r[0]["count"],r[0]["size"]))')" "(3, 9)"
eq "POST flags: public" "$(req -X POST -H 'content-type: application/json' -d '{"public":true}' "$API/store/$APP/notes/hello.txt")" 200
eq "POST flags result" "$(py 'import json,sys;d=json.load(open(sys.argv[1]));print(d["path"],d["public_url"])')" "notes/hello.txt /utilities/pub/$APP/notes/hello.txt"
eq "flagged item is public" "$(anon "$PUB/notes/hello.txt")" 200
eq "POST flags: private again, expires set" "$(req -X POST -H 'content-type: application/json' -d '{"public":false,"expires":4102444800000}' "$API/store/$APP/notes/hello.txt")" 200
req "$API/store/$APP/?prefix=notes/" >/dev/null
eq "flags listed, bytes untouched" "$(py 'import json,sys;r=json.load(open(sys.argv[1]))[0];print(r["public"],r["expires"],r["size"])')" "False 4102444800000 4"
eq "POST flags: clear expires" "$(req -X POST -H 'content-type: application/json' -d '{"expires":null}' "$API/store/$APP/notes/hello.txt")" 200
req "$API/store/$APP/?prefix=notes/" >/dev/null
eq "expires cleared" "$(py 'import json,sys;print(json.load(open(sys.argv[1]))[0]["expires"])')" None
eq "POST flags on missing is 404" "$(req -X POST -H 'content-type: application/json' -d '{"public":true}' "$API/store/$APP/nope.txt")" 404
eq "POST flags bad body is 400" "$(req -X POST -H 'content-type: application/json' -d 'nope' "$API/store/$APP/notes/hello.txt")" 400
eq "DELETE" "$(req -X DELETE "$API/store/$APP/raw.bin")" 204
eq "DELETE again" "$(req -X DELETE "$API/store/$APP/raw.bin")" 204
eq "GET deleted is 404" "$(req "$API/store/$APP/raw.bin")" 404
eq "binary round trip PUT" "$(printf 'a\0b\0\0' > "$TMP/z"; req -X PUT -H 'content-type: application/octet-stream' --data-binary @"$TMP/z" "$API/store/$APP/nul.bin")" 200
req "$API/store/$APP/nul.bin" >/dev/null
eq "binary round trip keeps trailing NULs" "$(cmp -s "$TMP/z" "$TMP/b" && echo same)" same

echo "-- 20 MB"
head -c 20000000 /dev/urandom > "$TMP/big"
eq "PUT 20 MB" "$(req -X PUT -H 'content-type: application/octet-stream' --data-binary @"$TMP/big" "$API/store/$APP/big.bin")" 200
eq "GET 20 MB" "$(req "$API/store/$APP/big.bin")" 200
eq "20 MB identical" "$(cmp -s "$TMP/big" "$TMP/b" && echo same)" same
req "$API/store/$APP/?prefix=big" >/dev/null
eq "20 MB size listed" "$(py 'import json,sys;print(json.load(open(sys.argv[1]))[0]["size"])')" 20000000
eq "DELETE 20 MB" "$(req -X DELETE "$API/store/$APP/big.bin")" 204

echo "-- public, burn, expiry"
eq "PUT public" "$(req -X PUT -H 'content-type: text/plain' -H 'x-utilities-public: true' --data-binary 'shared' "$API/store/$APP/pub/a%20b.txt")" 200
eq "public_url" "$(py 'import json,sys;print(json.load(open(sys.argv[1]))["public_url"])')" "/utilities/pub/$APP/pub/a%20b.txt"
eq "pub GET without cookie" "$(anon "$PUB/pub/a%20b.txt")" 200
eq "pub body" "$(body)" shared
eq "pub content-type" "$(hdr content-type)" text/plain
eq "pub cache-control" "$(hdr cache-control)" no-store
eq "pub HEAD" "$(anon -I "$PUB/pub/a%20b.txt")" 200
eq "pub GET again (not burn)" "$(anon "$PUB/pub/a%20b.txt")" 200
eq "pub POST is 405" "$(anon -X POST -d x "$PUB/pub/a%20b.txt")" 405
eq "private item not public" "$(anon "$PUB/notes/hello.txt")" 404
eq "pub 404 cache-control" "$(hdr cache-control)" no-store
eq "make private (re-PUT)" "$(req -X PUT -H 'content-type: text/plain' --data-binary 'shared' "$API/store/$APP/pub/a%20b.txt")" 200
eq "now private" "$(anon "$PUB/pub/a%20b.txt")" 404
eq "PUT burn" "$(req -X PUT -H 'content-type: text/plain' -H 'x-utilities-public: true' -H 'x-utilities-burn: true' --data-binary 'once' "$API/store/$APP/burn.txt")" 200
req "$API/store/$APP/?prefix=burn" >/dev/null
eq "burn listed" "$(py 'import json,sys;r=json.load(open(sys.argv[1]))[0];print(r["public"],r["burn"])')" "True True"
eq "burn HEAD does not burn" "$(anon -I "$PUB/burn.txt")" 200
eq "burn first read" "$(anon "$PUB/burn.txt")" 200
eq "burn body" "$(body)" once
eq "burn second read" "$(anon "$PUB/burn.txt")" 404
eq "burned item is gone from store" "$(req "$API/store/$APP/burn.txt")" 404
PAST=$(( $(date +%s) * 1000 - 1000 )); FUT=$(( $(date +%s) * 1000 + 3600000 ))
eq "PUT expired" "$(req -X PUT -H 'content-type: text/plain' -H 'x-utilities-public: true' -H "x-utilities-expires: $PAST" --data-binary 'old' "$API/store/$APP/old.txt")" 200
eq "expired pub is 404" "$(anon "$PUB/old.txt")" 404
eq "expired api GET is 404" "$(req "$API/store/$APP/old.txt")" 404
req "$API/store/$APP/?prefix=old" >/dev/null
eq "expired not listed" "$(body)" "[]"
eq "PUT expiring later" "$(req -X PUT -H 'content-type: text/plain' -H 'x-utilities-public: true' -H "x-utilities-expires: $FUT" --data-binary 'new' "$API/store/$APP/new.txt")" 200
eq "unexpired pub is 200" "$(anon "$PUB/new.txt")" 200
req "$API/store/$APP/?prefix=new" >/dev/null
eq "expires listed" "$(py 'import json,sys;print(json.load(open(sys.argv[1]))[0]["expires"])')" "$FUT"
eq "pub without path is 404" "$(anon "$BASE/utilities/pub/$APP")" 404

echo "-- webdav"
eq "OPTIONS" "$(req -X OPTIONS "$DAV/")" 200
eq "OPTIONS DAV header" "$(hdr dav)" "1,2"
has "OPTIONS Allow header" "$(hdr allow)" "PROPFIND"
eq "POST without override is 405" "$(req -X POST -d x "$DAV/x")" 405
eq "POST with bad override is 405" "$(req -X POST -H 'X-HTTP-Method-Override: PATCH' -d x "$DAV/x")" 405
eq "bad app is 404" "$(req -X POST -H 'X-HTTP-Method-Override: PROPFIND' "$BASE/utilities/dav/Bad_App/")" 404
dav() { local m=$1; shift; req -X POST -H "X-HTTP-Method-Override: $m" "$@"; }
eq "MKCOL" "$(dav MKCOL "$DAV/docs")" 201
eq "MKCOL existing is 405" "$(dav MKCOL "$DAV/docs")" 405
eq "PROPFIND empty collection" "$(dav PROPFIND -H 'Depth: 0' "$DAV/docs/")" 207
eq "PUT new" "$(req -X PUT -H 'content-type: text/plain' --data-binary 'dav <data> & "more"' "$DAV/docs/f%20one.txt")" 201
eq "PUT overwrite" "$(req -X PUT -H 'content-type: text/plain' --data-binary 'dav <data> & "more"' "$DAV/docs/f%20one.txt")" 204
eq "GET" "$(req "$DAV/docs/f%20one.txt")" 200
eq "GET body" "$(body)" 'dav <data> & "more"'
ETAG="\"$(printf '%s' 'dav <data> & "more"' | sha1sum | cut -c1-16)\""
eq "GET ETag" "$(hdr etag)" "$ETAG"
eq "GET Last-Modified is RFC 1123" "$(hdr last-modified | grep -cE '^[A-Z][a-z]{2}, [0-9]{2} [A-Z][a-z]{2} [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$')" 1
eq "HEAD" "$(req -I "$DAV/docs/f%20one.txt")" 200
eq "same namespace as api/store" "$(req "$API/store/$APP/docs/f%20one.txt")" 200
eq "dav GET missing is 404" "$(req "$DAV/docs/missing.txt")" 404
eq "dav GET collection is 404" "$(req "$DAV/docs")" 404
eq "PROPFIND depth 0" "$(dav PROPFIND -H 'Depth: 0' -H 'content-type: application/xml' --data-binary '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>' "$DAV/docs")" 207
has "207 content-type" "$(hdr content-type)" "application/xml; charset=utf-8"
X=$(body)
has "multistatus in DAV:" "$X" '<D:multistatus xmlns:D="DAV:">'
eq "depth 0 has one response" "$(grep -o '<D:response>' <<<"$X" | wc -l)" 1
has "collection href has trailing slash" "$X" "<D:href>/utilities/dav/$APP/docs/</D:href>"
has "collection resourcetype" "$X" '<D:resourcetype><D:collection/></D:resourcetype>'
has "displayname" "$X" '<D:displayname>docs</D:displayname>'
has "getlastmodified" "$X" '<D:getlastmodified>'
has "creationdate" "$X" '<D:creationdate>'
eq "PROPFIND depth 1" "$(dav PROPFIND -H 'Depth: 1' "$DAV/docs/")" 207
X=$(body)
eq "depth 1 has two responses" "$(grep -o '<D:response>' <<<"$X" | wc -l)" 2
has "file href percent-encoded" "$X" "<D:href>/utilities/dav/$APP/docs/f%20one.txt</D:href>"
has "file displayname" "$X" '<D:displayname>f one.txt</D:displayname>'
has "file length" "$X" '<D:getcontentlength>19</D:getcontentlength>'
has "file type" "$X" '<D:getcontenttype>text/plain</D:getcontenttype>'
has "file etag (escaped)" "$X" "<D:getetag>&quot;${ETAG:1:16}&quot;</D:getetag>"
has "file resourcetype empty" "$X" '<D:resourcetype/>'
eq "PROPFIND infinity treated as 1" "$(dav PROPFIND -H 'Depth: infinity' "$DAV/")" 207
X=$(body)
eq "root depth 1 lists root + children" "$(grep -o '<D:response>' <<<"$X" | wc -l | awk '{print ($1>=5)}')" 1
has "root href" "$X" "<D:href>/utilities/dav/$APP/</D:href>"
has "root displayname is app" "$X" "<D:displayname>$APP</D:displayname>"
has "implicit collection listed" "$X" "<D:href>/utilities/dav/$APP/notes/</D:href>"
eq "PROPFIND missing is 404" "$(dav PROPFIND -H 'Depth: 0' "$DAV/missing")" 404
eq "COPY new" "$(dav COPY -H "Destination: $DAV/docs/g.txt" "$DAV/docs/f%20one.txt")" 201
eq "copied body" "$(req "$DAV/docs/g.txt"; echo " $(body)")" '200 dav <data> & "more"'
eq "COPY overwrite T" "$(dav COPY -H "Destination: /utilities/dav/$APP/docs/g.txt" -H 'Overwrite: T' "$DAV/docs/f%20one.txt")" 204
eq "MOVE Overwrite F onto existing is 412" "$(dav MOVE -H "Destination: $DAV/docs/f%20one.txt" -H 'Overwrite: F' "$DAV/docs/g.txt")" 412
eq "412 left source" "$(req "$DAV/docs/g.txt")" 200
eq "MOVE to new (absolute URL)" "$(dav MOVE -H "Destination: $DAV/docs/h.txt" -H 'Overwrite: F' "$DAV/docs/g.txt")" 201
eq "moved source gone" "$(req "$DAV/docs/g.txt")" 404
eq "moved destination" "$(req "$DAV/docs/h.txt")" 200
eq "MOVE missing is 404" "$(dav MOVE -H "Destination: $DAV/docs/z.txt" "$DAV/docs/nope.txt")" 404
eq "COPY bad destination is 400" "$(dav COPY -H "Destination: /elsewhere/x" "$DAV/docs/h.txt")" 400
eq "COPY collection" "$(dav COPY -H "Destination: $DAV/docs2/" "$DAV/docs/")" 201
eq "collection copied deep" "$(req "$DAV/docs2/h.txt")" 200
eq "collection marker copied" "$(dav PROPFIND -H 'Depth: 1' "$DAV/docs2/"; echo " $(grep -o '<D:response>' "$TMP/b" | wc -l)")" "207 3"
eq "DELETE collection" "$(req -X DELETE "$DAV/docs2/")" 204
eq "collection contents gone" "$(req "$DAV/docs2/h.txt")" 404
eq "collection gone" "$(dav PROPFIND -H 'Depth: 0' "$DAV/docs2/")" 404
eq "DELETE missing is 404" "$(req -X DELETE "$DAV/docs2/")" 404
eq "LOCK" "$(dav LOCK -H 'content-type: application/xml' --data-binary '<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>' "$DAV/docs/h.txt")" 200
has "Lock-Token header" "$(hdr lock-token)" "<opaquelocktoken:"
has "activelock body" "$(body)" "<D:activelock>"
eq "UNLOCK" "$(dav UNLOCK -H "Lock-Token: $(hdr lock-token)" "$DAV/docs/h.txt")" 204
eq "PROPPATCH" "$(dav PROPPATCH -H 'content-type: application/xml' --data-binary '<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><x:color xmlns:x="urn:x">red</x:color></D:prop></D:set></D:propertyupdate>' "$DAV/docs/h.txt")" 207
has "PROPPATCH multistatus" "$(body)" "<D:href>/utilities/dav/$APP/docs/h.txt</D:href>"
has "PROPPATCH ok" "$(body)" "HTTP/1.1 200 OK"
eq "PUT to collection root is 405" "$(req -X PUT --data-binary x "$DAV/")" 405

echo "-- etag and conditional requests"
S="$API/store/$APP/cond.txt"
eq "PUT If-None-Match: * creates" "$(req -X PUT --data-binary 'hello world' -H 'If-None-Match: *' "$S")" 200
T1=$(hdr etag)
has "PUT returns an etag" "$T1" '"'
eq "PUT If-None-Match: * over existing is 412" "$(req -X PUT --data-binary x -H 'If-None-Match: *' "$S")" 412
req "$S" >/dev/null
eq "GET etag matches PUT etag" "$(hdr etag)" "$T1"
has "GET advertises ranges" "$(hdr accept-ranges)" bytes
eq "GET If-None-Match current is 304" "$(req -H "If-None-Match: $T1" "$S")" 304
eq "GET If-None-Match other is 200" "$(req -H 'If-None-Match: "nope"' "$S")" 200
eq "PUT stale If-Match is 412" "$(req -X PUT --data-binary x -H 'If-Match: "nope"' "$S")" 412
req "$S" >/dev/null; eq "412 left the body alone" "$(body)" "hello world"
eq "PUT current If-Match is 200" "$(req -X PUT --data-binary 'hello urbit' -H "If-Match: $T1" "$S")" 200
T2=$(hdr etag)
if [ "$T1" != "$T2" ]; then ok "new content, new etag"; else bad "new content, new etag" "$T1"; fi
eq "PUT with the old etag is now 412" "$(req -X PUT --data-binary x -H "If-Match: $T1" "$S")" 412
eq "If-Match list with W/ form" "$(req -X POST -H 'content-type: application/json' --data '{"public":false}' -H "If-Match: \"a\", W/$T2" "$S")" 200
eq "POST flags with stale If-Match is 412" "$(req -X POST -H 'content-type: application/json' --data '{}' -H "If-Match: $T1" "$S")" 412
eq "If-Match on a missing item is 412" "$(req -X PUT --data-binary x -H 'If-Match: *' "$API/store/$APP/nope.txt")" 412
eq "DELETE stale If-Match is 412" "$(req -X DELETE -H "If-Match: $T1" "$S")" 412
eq "DELETE current If-Match is 204" "$(req -X DELETE -H "If-Match: $T2" "$S")" 204
eq "dav PUT If-None-Match: * creates" "$(req -X PUT --data-binary v1 -H 'If-None-Match: *' "$DAV/cond/d.txt")" 201
D1=$(hdr etag)
eq "dav PUT stale If-Match is 412" "$(req -X PUT --data-binary v2 -H 'If-Match: "nope"' "$DAV/cond/d.txt")" 412
eq "dav PUT current If-Match is 204" "$(req -X PUT --data-binary v2 -H "If-Match: $D1" "$DAV/cond/d.txt")" 204
D2=$(hdr etag)
eq "dav DELETE stale If-Match is 412" "$(req -X DELETE -H "If-Match: $D1" "$DAV/cond/d.txt")" 412
eq "dav GET If-None-Match is 304" "$(req -H "If-None-Match: $D2" "$DAV/cond/d.txt")" 304
eq "dav DELETE" "$(req -X DELETE "$DAV/cond/d.txt")" 204

echo "-- range"
R="$API/store/$APP/range.bin"
req -X PUT --data-binary '0123456789' -H 'content-type: application/octet-stream' "$R" >/dev/null
eq "bytes=2-5 is 206" "$(req -H 'Range: bytes=2-5' "$R")" 206
eq "bytes=2-5 body" "$(body)" 2345
eq "bytes=2-5 content-range" "$(hdr content-range)" "bytes 2-5/10"
eq "bytes=7- body" "$(req -H 'Range: bytes=7-' "$R" >/dev/null; body)" 789
eq "bytes=-3 body" "$(req -H 'Range: bytes=-3' "$R" >/dev/null; body)" 789
eq "bytes=8-99 clamps" "$(req -H 'Range: bytes=8-99' "$R" >/dev/null; body)" 89
eq "bytes=0-0 is one byte" "$(req -H 'Range: bytes=0-0' "$R" >/dev/null; body)" 0
eq "bytes=10- is 416" "$(req -H 'Range: bytes=10-' "$R")" 416
eq "416 content-range" "$(hdr content-range)" "bytes */10"
eq "multiple ranges serve everything" "$(req -H 'Range: bytes=0-1,4-5' "$R")" 200
eq "malformed range serves everything" "$(req -H 'Range: lines=1-2' "$R")" 200
eq "dav GET range" "$(req -H 'Range: bytes=1-2' "$DAV/range.bin")" 206
eq "dav range body" "$(body)" 12
req -X PUT --data-binary 'abcdef' -H 'x-utilities-public: true' -H 'x-utilities-burn: true' "$API/store/$APP/rb.txt" >/dev/null
eq "pub range is 206" "$(anon -H 'Range: bytes=0-2' "$PUB/rb.txt")" 206
eq "pub range body" "$(body)" abc
has "pub range is no-store" "$(hdr cache-control)" no-store
eq "a partial read burns too" "$(anon "$PUB/rb.txt")" 404
req -X PUT --data-binary 'abcdef' -H 'x-utilities-public: true' -H 'x-utilities-burn: true' "$API/store/$APP/rb2.txt" >/dev/null
eq "unsatisfiable pub range is 416" "$(anon -H 'Range: bytes=50-' "$PUB/rb2.txt")" 416
eq "416 does not burn" "$(anon "$PUB/rb2.txt")" 200
eq "big blob range" "$(dd if=/dev/zero bs=1M count=5 2>/dev/null | tr '\0' 'z' > "$TMP/big"; req -X PUT --data-binary @"$TMP/big" "$API/store/$APP/big.bin" >/dev/null; req -H 'Range: bytes=5242870-' "$API/store/$APP/big.bin")" 206
eq "big blob tail" "$(body)" zzzzzzzzzz

echo "-- cleanup"
eq "DELETE app root via dav" "$(req -X DELETE "$DAV/")" 204
req "$API/store/$APP/" >/dev/null
eq "app empty" "$(body)" "[]"

echo "== $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
