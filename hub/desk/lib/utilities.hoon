::  utilities: url, header, time, xml and response helpers for %utilities
::
::    all of these mirror kit/serve.py (python's quote/unquote,
::    html.escape, email.utils.formatdate) so the ship and the mock
::    produce byte-identical answers.
::
|%
+$  pay  simple-payload:http
::
::  +split: split a cord on a single byte (keeps empty fields)
::
++  split
  |=  [sep=@t txt=@t]
  ^-  (list @t)
  =/  tap=(list @)  (rip 3 txt)
  =|  cur=(list @)
  =|  out=(list @t)
  |-  ^-  (list @t)
  ?~  tap  (flop [(rap 3 (flop cur)) out])
  ?:  =(i.tap sep)
    $(tap t.tap, cur ~, out [(rap 3 (flop cur)) out])
  $(tap t.tap, cur [i.tap cur])
::
::  +join: join cords with a separator
::
++  join
  |=  [sep=@t l=(list @t)]
  ^-  @t
  ?~  l  ''
  (rap 3 i.l (turn t.l |=(c=@t (cat 3 sep c))))
::
::  +starts: does .txt start with .pre?
::
++  starts
  |=  [pre=@t txt=@t]
  ^-  ?
  ?&  (gte (met 3 txt) (met 3 pre))
      =(pre (end [3 (met 3 pre)] txt))
  ==
::
::  +tail: .txt without its first .n bytes
::
++  tail
  |=  [n=@ud txt=@t]
  ^-  @t
  (rsh [3 n] txt)
::
++  hex-val
  |=  c=@
  ^-  (unit @)
  ?:  &((gte c '0') (lte c '9'))  `(sub c '0')
  ?:  &((gte c 'a') (lte c 'f'))  `(sub c 87)
  ?:  &((gte c 'A') (lte c 'F'))  `(sub c 55)
  ~
::
::  +decode: percent-decode (python unquote; .plus also maps + to space)
::
++  decode
  |=  [txt=@t plus=?]
  ^-  @t
  =/  tap=(list @)  (rip 3 txt)
  =|  out=(list @)
  |-  ^-  @t
  ?~  tap  (rap 3 (flop out))
  ?:  &(plus =(i.tap '+'))  $(tap t.tap, out [' ' out])
  ?.  =(i.tap '%')  $(tap t.tap, out [i.tap out])
  ?.  ?=([@ @ *] t.tap)  $(tap t.tap, out [i.tap out])
  =/  a  (hex-val i.t.tap)
  =/  b  (hex-val i.t.t.tap)
  ?:  |(?=(~ a) ?=(~ b))  $(tap t.tap, out [i.tap out])
  $(tap t.t.t.tap, out [(add (mul 16 u.a) u.b) out])
::
::  +encode: percent-encode one segment (python quote, uppercase hex)
::
++  encode
  |=  txt=@t
  ^-  @t
  %+  rap  3
  %+  turn  (rip 3 txt)
  |=  c=@
  ^-  @t
  ?:  ?|  &((gte c 'a') (lte c 'z'))
          &((gte c 'A') (lte c 'Z'))
          &((gte c '0') (lte c '9'))
          =(c '-')  =(c '.')  =(c '_')  =(c '~')
      ==
    c
  (crip ['%' (cuss ((x-co:co 2) c))])
::
::  +encode-path: percent-encode each /-separated segment
::
++  encode-path
  |=  p=@t
  ^-  @t
  (join '/' (turn (split '/' p) encode))
::
::  +esc: xml escape (python html.escape, quote=True)
::
++  esc
  |=  txt=@t
  ^-  @t
  %+  rap  3
  %+  turn  (rip 3 txt)
  |=  c=@
  ^-  @t
  ?+  c  c
    %'&'   '&amp;'
    %'<'   '&lt;'
    %'>'   '&gt;'
    %'"'   '&quot;'
    %'\''  '&#x27;'
  ==
::
::  +split-url: raw path segments (no leading /) and the raw query
::
++  split-url
  |=  url=@t
  ^-  [(list @t) @t]
  =/  parts  (split '?' url)
  =/  pax=@t  ?~(parts '' i.parts)
  =/  qry=@t  ?~(parts '' ?~(t.parts '' (join '?' t.parts)))
  =?  pax  (starts '/' pax)  (tail 1 pax)
  [(split '/' pax) qry]
::
::  +query: first value of .key in a query string (python parse_qs)
::
++  query
  |=  [key=@t qry=@t]
  ^-  (unit @t)
  =/  kvs  (split '&' qry)
  |-  ^-  (unit @t)
  ?~  kvs  ~
  =/  kv  (split '=' i.kvs)
  ?.  ?=([@ ^] kv)  $(kvs t.kvs)
  ?.  =(key (decode i.kv &))  $(kvs t.kvs)
  =/  val  (decode (join '=' t.kv) &)
  ?:  =('' val)  $(kvs t.kvs)
  `val
::
::  +header: case-insensitive request header lookup
::
++  header
  |=  [key=@t hed=header-list:http]
  ^-  (unit @t)
  ?~  hed  ~
  ?:  =(key (crip (cass (trip key.i.hed))))  `value.i.hed
  $(hed t.hed)
::
::  +sane-app: [a-z0-9-]+
::
++  sane-app
  |=  a=@t
  ^-  ?
  ?:  =('' a)  |
  %+  levy  (rip 3 a)
  |=  c=@
  ?|  &((gte c 'a') (lte c 'z'))
      &((gte c '0') (lte c '9'))
      =(c '-')
  ==
::
::  time
::
++  unix-ms
  |=  d=@da
  ^-  @ud
  (div (mul (sub d ~1970.1.1) 1.000) ~s1)
::
++  from-ms
  |=  ms=@ud
  ^-  @da
  (add ~1970.1.1 (div (mul ms ~s1) 1.000))
::
++  pad2
  |=  n=@ud
  ^-  tape
  ?:((lth n 10) ['0' (a-co:co n)] (a-co:co n))
::
::  +rfc1123: 'Mon, 12 Oct 2026 22:33:37 GMT'
::
++  rfc1123
  |=  ms=@ud
  ^-  @t
  =/  d  (yore (from-ms ms))
  =/  wd=@t
    %+  snag  (mod (add 4 (div ms 86.400.000)) 7)
    `(list @t)`~['Sun' 'Mon' 'Tue' 'Wed' 'Thu' 'Fri' 'Sat']
  =/  mo=@t
    %+  snag  (dec m.d)
    ^-  (list @t)
    ~['Jan' 'Feb' 'Mar' 'Apr' 'May' 'Jun' 'Jul' 'Aug' 'Sep' 'Oct' 'Nov' 'Dec']
  %-  crip
  ;:  weld
    (trip wd)  ", "  (pad2 d.t.d)  " "  (trip mo)  " "  (a-co:co y.d)
    " "  (pad2 h.t.d)  ":"  (pad2 m.t.d)  ":"  (pad2 s.t.d)  " GMT"
  ==
::
::  +iso: '2026-10-12T22:33:37Z'
::
++  iso
  |=  ms=@ud
  ^-  @t
  =/  d  (yore (from-ms ms))
  %-  crip
  ;:  weld
    (a-co:co y.d)  "-"  (pad2 m.d)  "-"  (pad2 d.t.d)
    "T"  (pad2 h.t.d)  ":"  (pad2 m.t.d)  ":"  (pad2 s.t.d)  "Z"
  ==
::
::  +etag: '"<first 16 hex of sha1>"'
::
++  etag
  |=  dat=octs
  ^-  @t
  =/  h=@  (sha-1l:sha [p.dat (rev 3 p.dat q.dat)])
  (crip "\"{(scag 16 ((x-co:co 40) h))}\"")
::
::  +trim: drop leading and trailing spaces
::
++  trim
  |=  t=@t
  ^-  @t
  =/  l=(list @)  (rip 3 t)
  =.  l  |-(?~(l ~ ?:(=(' ' i.l) $(l t.l) l)))
  =.  l  (flop l)
  =.  l  |-(?~(l ~ ?:(=(' ' i.l) $(l t.l) l)))
  (rap 3 (flop l))
::
::  +etag-in: does an If-Match/If-None-Match value list name .tag?
::
::    '*' matches any existing resource; weak W/ prefixes are ignored.
::
++  etag-in
  |=  [val=@t tag=@t]
  ^-  ?
  %+  lien  (split ',' val)
  |=  t=@t
  =/  s=@t  (trim t)
  =?  s  (starts 'W/' s)  (tail 2 s)
  |(=('*' s) =(tag s))
::
::  +precondition: If-Match / If-None-Match for a write
::
::    .tag is the current etag, ~ when nothing is stored there.
::    & = go ahead, | = 412.
::
++  precondition
  |=  [hed=header-list:http tag=(unit @t)]
  ^-  ?
  =/  im  (header 'if-match' hed)
  =/  inm  (header 'if-none-match' hed)
  ?&  ?~(im & ?~(tag | (etag-in u.im u.tag)))
      ?~(inm & ?~(tag & !(etag-in u.inm u.tag)))
  ==
::
::  +range: a single "bytes=" Range against .len bytes
::
::    ~ = no usable Range (absent, malformed or several ranges: serve
::    the whole body), [~ ~] = unsatisfiable (416), [~ ~ a b] = bytes
::    a through b inclusive.
::
++  range
  |=  [hed=header-list:http len=@ud]
  ^-  (unit (unit [@ud @ud]))
  =/  val  (header 'range' hed)
  ?~  val  ~
  ?.  (starts 'bytes=' u.val)  ~
  =/  spec  (trim (tail 6 u.val))
  ?:  (lien (rip 3 spec) |=(c=@ =(c ',')))  ~
  =/  ab  (split '-' spec)
  ?.  ?=([@ @ ~] ab)  ~
  =/  lo-t  (trim i.ab)
  =/  hi-t  (trim i.t.ab)
  =/  lo=(unit @ud)  (rush lo-t dem)
  =/  hi=(unit @ud)  (rush hi-t dem)
  ?:  =('' lo-t)
    ::  suffix range: the last .hi bytes
    ?~  hi  ~
    ?:  |(=(0 u.hi) =(0 len))  [~ ~]
    ``[(sub len (min len u.hi)) (dec len)]
  ?~  lo  ~
  ?:  &(!=('' hi-t) ?=(~ hi))  ~
  ?:  &(?=(^ hi) (lth u.hi u.lo))  ~
  ?:  (gte u.lo len)  [~ ~]
  ``[u.lo (min (dec len) (fall hi (dec len)))]
::
::  +serve: a stored body for GET/HEAD
::
::    honours a single Range (206, or 416) and otherwise If-None-Match
::    (304). 206 responses carry no etag, so range reads of a big blob
::    don't hash all of it each time. .extra goes on every response.
::
++  serve
  |=  [hed=header-list:http type=@t dat=octs extra=header-list:http]
  ^-  pay
  =/  len=@t  (crip (a-co:co p.dat))
  =/  base=header-list:http
    [['content-type' type] ['accept-ranges' 'bytes'] extra]
  =/  rng  (range hed p.dat)
  ?~  rng
    =/  tag  (etag dat)
    =/  inm  (header 'if-none-match' hed)
    ?:  &(?=(^ inm) (etag-in u.inm tag))
      [[304 [['etag' tag] extra]] ~]
    [[200 [['etag' tag] base]] `dat]
  ?~  u.rng
    [[416 [['content-range' (rap 3 'bytes */' len ~)] extra]] ~]
  =/  [a=@ud b=@ud]  u.u.rng
  =/  n=@ud  +((sub b a))
  =/  cr=@t
    (rap 3 'bytes ' (crip (a-co:co a)) '-' (crip (a-co:co b)) '/' len ~)
  [[206 [['content-range' cr] base]] `[n (cut 3 [a n] q.dat)]]
::
::  responses
::
++  text
  |=  [code=@ud msg=@t]
  ^-  pay
  [[code ['content-type' 'text/plain']~] `(as-octs:mimes:html msg)]
::
++  json-pay
  |=  [code=@ud jon=json]
  ^-  pay
  :-  [code ['content-type' 'application/json']~]
  `(as-octs:mimes:html (en:json:html jon))
::
++  err
  |=  [code=@ud msg=@t]
  ^-  pay
  (json-pay code (pairs:enjs:format ~[error+s+msg]))
::
++  xml
  |=  [code=@ud body=@t]
  ^-  pay
  :-  [code ['content-type' 'application/xml; charset=utf-8']~]
  `(as-octs:mimes:html body)
::
::  +blank: a body-less response (204, or 201 like the mock)
::
++  blank
  |=  code=@ud
  ^-  pay
  ?:  =(204 code)  [[204 ~] ~]
  [[code ['content-type' 'text/plain']~] ~]
--
