::  utilities: the %utilities hub agent
::
::    binds /utilities/api, /utilities/dav and /utilities/pub (eyre picks
::    the longest bound prefix, so %utilities-fileserver keeps /utilities)
::    and implements kit/CONTRACT.md: catalog, install/uninstall of
::    satellite desks through kiln, a per-app blob store in agent state,
::    public links (burn, expiry) and WebDAV.
::
/-  sur=utilities
/+  default-agent, dbug, ul=utilities, clog=utilities-catalog
|%
+$  card  card:agent:gall
+$  versioned-state  $%(state-0:sur)
+$  item  item:sur
+$  pay   pay:ul
+$  kind  ?(%dir %file)
+$  bound  [=pay cards=(list card) new=state-0:sur]
--
=|  state-0:sur
=*  state  -
%-  agent:dbug
^-  agent:gall
=<
|_  =bowl:gall
+*  this  .
    def   ~(. (default-agent this %.n) bowl)
    hc    ~(. +> bowl)
::
++  on-init
  ^-  (quip card _this)
  :_  this
  %+  turn  `(list path)`~[/utilities/api /utilities/dav /utilities/pub]
  |=  p=path
  [%pass [%eyre %connect p] %arvo %e %connect [~ p] dap.bowl]
::
++  on-save  !>(state)
::
++  on-load
  |=  old=vase
  ^-  (quip card _this)
  =/  ver  !<(versioned-state old)
  ?-  -.ver
    %0  [~ this(state ver)]
  ==
::
++  on-poke
  |=  [=mark =vase]
  ^-  (quip card _this)
  ?+  mark  (on-poke:def mark vase)
      %handle-http-request
    =+  !<([rid=@ta req=inbound-request:eyre] vase)
    =/  res=bound  (handle:hc req)
    =/  =pay  pay.res
    ::NOTE  don't set content-length: eyre streams the header fact
    ::      before the data fact and vere then answers with length 0.
    ::      responses go out chunked; HEAD carries no length.
    ::
    =?  data.pay  ?=(%'HEAD' method.request.req)  ~
    =/  =path  /http-response/[rid]
    :_  this(state new.res)
    %+  weld  cards.res
    ^-  (list card)
    :~  [%give %fact ~[path] %http-response-header !>(response-header.pay)]
        [%give %fact ~[path] %http-response-data !>(data.pay)]
        [%give %kick ~[path] ~]
    ==
  ==
::
++  on-watch
  |=  =path
  ^-  (quip card _this)
  ?+  path  (on-watch:def path)
    [%http-response @ ~]  [~ this]
  ==
::
++  on-leave  on-leave:def
::
++  on-peek
  |=  =path
  ^-  (unit (unit cage))
  ?+  path  (on-peek:def path)
    [%x %publisher ~]  ``noun+!>(publisher-ship:hc)
  ==
::
++  on-agent
  |=  [=wire =sign:agent:gall]
  ^-  (quip card _this)
  ?+  wire  (on-agent:def wire sign)
      [%kiln @ @ ~]
    ?.  ?=(%poke-ack -.sign)  [~ this]
    ?~  p.sign  [~ this]
    %-  (slog leaf+"utilities: kiln {(trip i.t.wire)} {(trip i.t.t.wire)} failed" u.p.sign)
    [~ this(pending (~(del by pending) i.t.t.wire))]
  ==
::
++  on-arvo
  |=  [=wire =sign-arvo]
  ^-  (quip card _this)
  ?+  wire  (on-arvo:def wire sign-arvo)
      [%eyre %connect *]
    ?>  ?=([%eyre %bound *] sign-arvo)
    ~?  !accepted.sign-arvo  [dap.bowl %binding-rejected binding.sign-arvo]
    [~ this]
  ==
::
++  on-fail   on-fail:def
--
::
::  helper core: request handling. arms return a $bound (response,
::  extra cards, new state); the agent turns it into the eyre response.
::
|_  =bowl:gall
++  now-ms  (unix-ms:ul now.bowl)
::
++  done
  |=  =pay
  ^-  bound
  [pay ~ state]
::
++  handle
  |=  req=inbound-request:eyre
  ^-  bound
  =/  [segs=(list @t) qry=@t]  (split-url:ul url.request.req)
  ?+  segs  (done (text:ul 404 'not found'))
    [%utilities %api *]  (api t.t.segs qry req)
    [%utilities %pub *]  (pub t.t.segs req)
    [%utilities %dav *]  (dav t.t.segs req)
  ==
::
::  store primitives
::
++  items
  |=  app=@t
  ^-  (map @t item)
  (~(gut by store) app ~)
::
++  get-item
  |=  [app=@t p=@t]
  ^-  (unit item)
  (~(get by (items app)) p)
::
++  put-item
  |=  [app=@t p=@t it=item]
  ^+  store
  (~(put by store) app (~(put by (items app)) p it))
::
++  del-item
  |=  [app=@t p=@t]
  ^+  store
  =/  its  (~(del by (items app)) p)
  ?~  its  (~(del by store) app)
  (~(put by store) app its)
::
::  +del-tree: delete .p and everything under .p/ ('' = the whole app)
::
++  del-tree
  |=  [app=@t p=@t]
  ^+  store
  ?:  =('' p)  (~(del by store) app)
  =/  pre  (cat 3 p '/')
  =/  its=(map @t item)
    %-  ~(rep by (items app))
    |=  [[k=@t v=item] acc=(map @t item)]
    ?:  |(=(k p) (starts:ul pre k))  acc
    (~(put by acc) k v)
  ?~  its  (~(del by store) app)
  (~(put by store) app its)
::
++  alive
  |=  it=item
  ^-  ?
  ?~  expires.it  &
  (gth u.expires.it now-ms)
::
::  +cur-tag: etag of what a write would replace, ~ if nothing live
::
++  cur-tag
  |=  [app=@t p=@t]
  ^-  (unit @t)
  =/  it  (get-item app p)
  ?~  it  ~
  ?:  |(dir.u.it !(alive u.it))  ~
  `(etag:ul data.u.it)
::
::  +with-etag: add an etag header to a response
::
++  with-etag
  |=  [r=pay dat=octs]
  ^-  pay
  r(headers.response-header [['etag' (etag:ul dat)] headers.response-header.r])
::
::  +clean-path: decode segments, drop empty ones, join with /
::
++  clean-path
  |=  segs=(list @t)
  ^-  @t
  %+  join:ul  '/'
  %+  skip  (turn segs |=(s=@t (decode:ul s |)))
  |=(s=@t =('' s))
::
::  +app-summary: apps that hold data, with item count and total size
::
++  app-summary
  ^-  json
  :-  %a
  %+  murn  (sort ~(tap in ~(key by store)) aor)
  |=  app=@t
  =/  its  (skim ~(val by (items app)) |=(it=item &(!dir.it (alive it))))
  ?~  its  ~
  %-  some
  %-  pairs:enjs:format
  :~  app+s+app
      count+(numb:enjs:format (lent its))
      size+(numb:enjs:format (roll (turn its |=(it=item p.data.it)) add))
  ==
::
++  public-url
  |=  [app=@t p=@t]
  ^-  @t
  (rap 3 '/utilities/pub/' app '/' (encode-path:ul p) ~)
::
::  catalog and kiln
::
++  catalog-apps
  ^-  (list (map @t json))
  =/  jon  (need (de:json:html raw:clog))
  ?>  ?=([%a *] jon)
  %+  murn  p.jon
  |=  j=json
  ?.  ?=([%o *] j)  ~
  `p.j
::
++  app-desk
  |=  m=(map @t json)
  ^-  @t
  =/  d  (~(get by m) 'desk')
  ?.  ?=([~ %s @] d)  ''
  p.u.d
::
++  in-catalog
  |=  d=@t
  ^-  ?
  (lien catalog-apps |=(m=(map @t json) =(d (app-desk m))))
::
++  kiln-sources
  ^-  (map desk [ship desk])
  .^  (map desk [ship desk])
      %gx
      /(scot %p our.bowl)/hood/(scot %da now.bowl)/kiln/sources/noun
  ==
::
++  tire
  ^-  rock:tire:clay
  .^(rock:tire:clay %cx /(scot %p our.bowl)//(scot %da now.bowl)/tire)
::
::  +publisher-ship: override, else where this desk syncs from, else us
::
++  publisher-ship
  ^-  ship
  ?^  publisher  u.publisher
  =/  src  (~(get by kiln-sources) q.byk.bowl)
  ?~  src  our.bowl
  -.u.src
::
::  +status: installed, installing, suspended or available
::
::    clay's tire is the ground truth for whether a desk runs (%live),
::    is waiting for its first sync/commit (%held) or was uninstalled
::    (%dead); kiln's sync sources and our own pending installs cover
::    the time before clay knows the desk at all.
::
++  status
  |=  [d=desk rock=rock:tire:clay srcs=(map desk [ship desk])]
  ^-  @t
  =/  z=(unit zest:clay)  (bind (~(get by rock) d) |=([=zest:clay *] zest))
  =/  pen  (~(get by pending) d)
  =/  recent=?  ?~(pen | (lth (sub now.bowl (min now.bowl u.pen)) ~m10))
  ?:  =(`%live z)  'installed'
  ?:  =(`%held z)  'installing'
  ?:  &(?=(~ z) (~(has by srcs) d))  'installing'
  ?:  recent  'installing'
  ?:  =(`%dead z)  'suspended'
  'available'
::
++  catalog
  ^-  json
  =/  rock  tire
  =/  srcs  kiln-sources
  %-  pairs:enjs:format
  :~  publisher+s+(scot %p publisher-ship)
    :-  %apps
    :-  %a
    %+  turn  catalog-apps
    |=  m=(map @t json)
    =/  d  (app-desk m)
    :-  %o
    %-  ~(gas by m)
    :~  ['href' s+(rap 3 '/' d '/' ~)]
        ['status' s+(status d rock srcs)]
    ==
  ==
::
++  body-json
  |=  rq=request:http
  ^-  (unit json)
  ?~  body.rq  ~
  (de:json:html q.u.body.rq)
::
++  body-desk
  |=  rq=request:http
  ^-  (unit desk)
  =/  j  (body-json rq)
  ?.  ?=([~ %o *] j)  ~
  =/  d  (~(get by p.u.j) 'desk')
  ?.  ?=([~ %s @] d)  ~
  ?.  ((sane %tas) p.u.d)  ~
  `p.u.d
::
++  install
  |=  rq=request:http
  ^-  bound
  =/  d  (body-desk rq)
  ?~  d  (done (err:ul 400 'bad desk'))
  ?.  (in-catalog u.d)  (done (err:ul 400 'not in catalog'))
  =/  pub  publisher-ship
  ?:  ?&  =(pub our.bowl)
          !(~(has in .^((set desk) %cd /(scot %p our.bowl)//(scot %da now.bowl))) u.d)
      ==
    (done (err:ul 404 'desk not found on publisher'))
  ::  a desk we uninstalled is still here, suspended. kiln sets it
  ::  %held and only goes %live on the next update, which never comes
  ::  if the publisher's copy is unchanged, so revive it as well.
  =/  dead=?  =(`%dead (bind (~(get by tire) u.d) |=([=zest:clay *] zest)))
  =/  cards=(list card)
    :~  :*  %pass  /kiln/install/[u.d]  %agent  [our.bowl %hood]
            %poke  %kiln-install  !>([u.d pub u.d])
    ==  ==
  =?  cards  dead
    %+  snoc  cards
    [%pass /kiln/revive/[u.d] %agent [our.bowl %hood] %poke %kiln-revive !>(`desk`u.d)]
  :+  (json-pay:ul 202 (pairs:enjs:format ~[ok+b+&]))
    cards
  state(pending (~(put by pending) u.d now.bowl))
::
++  uninstall
  |=  rq=request:http
  ^-  bound
  =/  d  (body-desk rq)
  ?~  d  (done (err:ul 400 'bad desk'))
  ?.  (in-catalog u.d)  (done (err:ul 400 'not in catalog'))
  =/  cards=(list card)
    ?.  (~(has by tire) u.d)  ~
    :~  :*  %pass  /kiln/uninstall/[u.d]  %agent  [our.bowl %hood]
            %poke  %kiln-uninstall  !>(`desk`u.d)
    ==  ==
  :+  (json-pay:ul 202 (pairs:enjs:format ~[ok+b+&]))
    cards
  state(pending (~(del by pending) u.d))
::
++  set-publisher
  |=  rq=request:http
  ^-  bound
  =/  j  (body-json rq)
  ?.  ?=([~ %o *] j)  (done (err:ul 400 'bad body'))
  =/  s  (~(get by p.u.j) 'ship')
  =/  new=(unit (unit ship))
    ?+  s  ~
      [~ ~]       `~
      [~ %s @]    ?~(p=(slaw %p p.u.s) ~ ``u.p)
    ==
  ?~  new  (done (err:ul 400 'bad ship'))
  =.  publisher  u.new
  :+  (json-pay:ul 200 (pairs:enjs:format ~[publisher+s+(scot %p publisher-ship)]))
    ~
  state
::
::  /utilities/api
::
++  api
  |=  [segs=(list @t) qry=@t req=inbound-request:eyre]
  ^-  bound
  ?.  authenticated.req  (done (err:ul 401 'unauthorized'))
  =*  rq  request.req
  =/  meth=@t  method.rq
  ?:  &(?=([%catalog ~] segs) =('GET' meth))  (done (json-pay:ul 200 catalog))
  ?:  &(?=([%install ~] segs) =('POST' meth))  (install rq)
  ?:  &(?=([%uninstall ~] segs) =('POST' meth))  (uninstall rq)
  ?:  &(?=([%publisher ~] segs) =('POST' meth))  (set-publisher rq)
  ?:  &(?=([%store %$ ~] segs) =('GET' meth))  (done (json-pay:ul 200 app-summary))
  ?.  ?=([%store @ ^] segs)  (done (err:ul 404 'not found'))
  =/  app=@t  i.t.segs
  ?.  (sane-app:ul app)  (done (err:ul 404 'not found'))
  =/  p=@t  (clean-path t.t.segs)
  ?:  &(=('' p) =('GET' meth))
    =/  pre  (fall (query:ul 'prefix' qry) '')
    %-  done
    %+  json-pay:ul  200
    :-  %a
    %+  murn
      (sort ~(tap by (items app)) |=([a=[k=@t *] b=[k=@t *]] (aor k.a k.b)))
    |=  [k=@t it=item]
    ?:  |(dir.it !(alive it) !(starts:ul pre k))  ~
    %-  some
    %-  pairs:enjs:format
    :~  path+s+k
        type+s+type.it
        size+(numb:enjs:format p.data.it)
        modified+(numb:enjs:format modified.it)
        public+b+public.it
        burn+b+burn.it
        expires+?~(expires.it ~ (numb:enjs:format u.expires.it))
    ==
  ?:  =('' p)  (done (err:ul 400 'path required'))
  ?:  |(=('GET' meth) =('HEAD' meth))
    =/  it  (get-item app p)
    ?:  |(?=(~ it) dir.u.it !(alive u.it))  (done (err:ul 404 'not found'))
    (done (serve:ul header-list.rq type.u.it data.u.it ~))
  ?.  (precondition:ul header-list.rq (cur-tag app p))
    (done (err:ul 412 'precondition failed'))
  ?:  =('PUT' meth)
    =*  hed  header-list.rq
    =/  typ  (fall (header:ul 'content-type' hed) '')
    =/  pub  =(`'true' (header:ul 'x-utilities-public' hed))
    =/  it=item
      :*  ?:(=('' typ) 'application/octet-stream' typ)
          (fall body.rq [0 0])
          now-ms
          pub
          =(`'true' (header:ul 'x-utilities-burn' hed))
          =/  e  (header:ul 'x-utilities-expires' hed)
          ?~(e ~ (rush u.e dem))
          |
      ==
    :+  %+  with-etag
          %+  json-pay:ul  200
          %-  pairs:enjs:format
          :~  path+s+p
              ['public_url' ?.(pub ~ s+(public-url app p))]
          ==
        data.it
      ~
    state(store (put-item app p it))
  ?:  =('DELETE' meth)
    [(blank:ul 204) ~ state(store (del-item app p))]
  ?:  =('POST' meth)
    ::  change flags without re-uploading: {public?, burn?, expires?}
    ::
    =/  it  (get-item app p)
    ?:  |(?=(~ it) dir.u.it !(alive u.it))  (done (err:ul 404 'not found'))
    =/  j  (body-json rq)
    ?.  ?=([~ %o *] j)  (done (err:ul 400 'bad body'))
    =*  m  p.u.j
    =/  new=item  u.it
    =/  pu  (~(get by m) 'public')
    =?  public.new  ?=([~ %b *] pu)  p.u.pu
    =/  bu  (~(get by m) 'burn')
    =?  burn.new  ?=([~ %b *] bu)  p.u.bu
    =/  ex  (~(get by m) 'expires')
    =?  expires.new  ?=([~ ~] ex)  ~
    =?  expires.new  ?=([~ %n *] ex)  (rush p.u.ex dem)
    :+  %+  json-pay:ul  200
        %-  pairs:enjs:format
        :~  path+s+p
            ['public_url' ?.(public.new ~ s+(public-url app p))]
        ==
      ~
    state(store (put-item app p new))
  (done (err:ul 405 'method not allowed'))
::
::  /utilities/pub: public reads, no login
::
++  pub
  |=  [segs=(list @t) req=inbound-request:eyre]
  ^-  bound
  =/  meth=@t  method.request.req
  ?.  |(=('GET' meth) =('HEAD' meth))  (done (text:ul 405 'method not allowed'))
  =/  parts  (turn segs |=(s=@t (decode:ul s |)))
  ?.  ?=([@ ^] parts)  (done (text:ul 404 'not found'))
  =/  app  i.parts
  =/  p  (join:ul '/' t.parts)
  =/  it  (get-item app p)
  =/  nos  ['cache-control' 'no-store']
  ?:  |(?=(~ it) dir.u.it !public.u.it !(alive u.it))
    =/  r  (text:ul 404 'not found')
    (done r(headers.response-header [nos headers.response-header.r]))
  =/  r=pay  (serve:ul header-list.request.req type.u.it data.u.it ~[nos])
  :+  r
    ~
  ::  burn once content has gone out (a partial read counts)
  =/  code  status-code.response-header.r
  ?.  &(burn.u.it =('GET' meth) |(=(200 code) =(206 code)))
    state
  state(store (del-item app p))
::
::  /utilities/dav: webdav (other methods arrive as POST + override)
::
++  dav-methods
  ^-  (list @t)
  ~['PROPFIND' 'PROPPATCH' 'MKCOL' 'COPY' 'MOVE' 'LOCK' 'UNLOCK']
::
++  dav
  |=  [segs=(list @t) req=inbound-request:eyre]
  ^-  bound
  ?.  authenticated.req
    %-  done
    :_  `(as-octs:mimes:html 'unauthorized')
    :-  401
    :~  ['content-type' 'text/plain']
        ['www-authenticate' 'Basic realm="urbit"']
    ==
  =*  rq  request.req
  =/  meth=@t  method.rq
  =?  meth  =('POST' meth)
    (crip (cuss (trip (fall (header:ul 'x-http-method-override' header-list.rq) ''))))
  ?:  &(=('POST' method.rq) !(lien dav-methods |=(m=@t =(m meth))))
    (done (text:ul 405 'method not allowed'))
  =/  parts  (turn segs |=(s=@t (decode:ul s |)))
  =/  app=@t  ?~(parts '' i.parts)
  ?.  (sane-app:ul app)  (done (text:ul 404 'not found'))
  =/  p=@t
    %+  join:ul  '/'
    (skip ?~(parts ~ t.parts) |=(s=@t =('' s)))
  =/  dc  ~(. dav-core [app p rq])
  ?+  meth  (done (text:ul 405 'method not allowed'))
    %'OPTIONS'    options:dc
    %'GET'        get:dc
    %'HEAD'       get:dc
    %'PUT'        put:dc
    %'DELETE'     delete:dc
    %'MKCOL'      mkcol:dc
    %'PROPFIND'   propfind:dc
    %'PROPPATCH'  proppatch:dc
    %'COPY'       (copy:dc |)
    %'MOVE'       (copy:dc &)
    %'LOCK'       lock:dc
    %'UNLOCK'     (done (blank:ul 204))
  ==
::
++  dav-kind
  |=  [app=@t p=@t]
  ^-  (unit kind)
  ?:  =('' p)  `%dir
  =/  its  (items app)
  =/  it  (~(get by its) p)
  ?:  &(?=(^ it) (alive u.it))  `?:(dir.u.it %dir %file)
  =/  pre  (cat 3 p '/')
  ?:  (lien ~(tap in ~(key by its)) |=(k=@t (starts:ul pre k)))  `%dir
  ~
::
++  dav-href
  |=  [app=@t p=@t =kind]
  ^-  @t
  =/  base  (rap 3 '/utilities/dav/' app '/' (encode-path:ul p) ~)
  ?:  =('' p)  base
  ?:(?=(%dir kind) (cat 3 base '/') base)
::
++  dav-core
  |_  [app=@t p=@t rq=request:http]
  ++  hed  header-list.rq
  ::
  ++  options
    ^-  bound
    %-  done
    :_  ~
    :-  200
    :~  ['content-type' 'text/plain']
        ['dav' '1,2']
        ['ms-author-via' 'DAV']
        :-  'allow'
        'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK'
    ==
  ::
  ++  get
    ^-  bound
    =/  it  (get-item app p)
    ?:  |(?=(~ it) dir.u.it !(alive u.it))  (done (text:ul 404 'not found'))
    %-  done
    (serve:ul hed type.u.it data.u.it ['last-modified' (rfc1123:ul modified.u.it)]~)
  ::
  ++  put
    ^-  bound
    ?:  =('' p)  (done (text:ul 405 'cannot PUT a collection'))
    ?.  (precondition:ul hed (cur-tag app p))
      (done (text:ul 412 'precondition failed'))
    =/  existed  ?=(^ (get-item app p))
    =/  typ  (fall (header:ul 'content-type' hed) '')
    =/  it=item
      :*  ?:(=('' typ) 'application/octet-stream' typ)
          (fall body.rq [0 0])
          now-ms  |  |  ~  |
      ==
    :+  (with-etag (blank:ul ?:(existed 204 201)) data.it)
      ~
    state(store (put-item app p it))
  ::
  ++  delete
    ^-  bound
    ?~  (dav-kind app p)  (done (text:ul 404 'not found'))
    ?.  (precondition:ul hed (cur-tag app p))
      (done (text:ul 412 'precondition failed'))
    [(blank:ul 204) ~ state(store (del-tree app p))]
  ::
  ++  mkcol
    ^-  bound
    ?^  (dav-kind app p)  (done (text:ul 405 'exists'))
    =/  it=item  ['httpd/unix-directory' [0 0] now-ms | | ~ &]
    [(blank:ul 201) ~ state(store (put-item app p it))]
  ::
  ++  entries
    |=  [knd=kind depth=@t]
    ^-  (list [@t kind])
    :-  [p knd]
    ?.  &(?=(%dir knd) !=('0' depth))  ~
    =/  pre  ?:(=('' p) '' (cat 3 p '/'))
    =/  kids=(map @t kind)
      %-  ~(rep by (items app))
      |=  [[k=@t it=item] acc=(map @t kind)]
      ?.  &((starts:ul pre k) !=(k p) (alive it))  acc
      =/  tal  (split:ul '/' (tail:ul (met 3 pre) k))
      ?~  tal  acc
      =/  child  (cat 3 pre i.tal)
      =/  kid=kind  ?:(|(?=(^ t.tal) dir.it) %dir %file)
      ?:  =(`%dir (~(get by acc) child))  acc
      (~(put by acc) child kid)
    (sort ~(tap by kids) |=([a=[k=@t *] b=[k=@t *]] (aor k.a k.b)))
  ::
  ++  propfind
    ^-  bound
    =/  knd  (dav-kind app p)
    ?~  knd  (done (text:ul 404 'not found'))
    =/  depth  (fall (header:ul 'depth' hed) '1')
    =/  now  now-ms
    =/  resp=(list @t)
      %+  turn  (entries u.knd depth)
      |=  [q=@t k=kind]
      =/  it  (get-item app q)
      =/  name=@t  ?:(=('' q) app (rear (split:ul '/' q)))
      =/  ms=@ud  ?~(it now modified.u.it)
      =/  props=@t
        ?:  ?=(%dir k)
          %+  rap  3
          :~  '<D:resourcetype><D:collection/></D:resourcetype>'
              '<D:getcontentlength>0</D:getcontentlength>'
              '<D:getcontenttype>httpd/unix-directory</D:getcontenttype>'
              '<D:getetag>"dir"</D:getetag>'
          ==
        ?>  ?=(^ it)
        %+  rap  3
        :~  '<D:resourcetype/>'
            '<D:getcontentlength>'  (crip (a-co:co p.data.u.it))  '</D:getcontentlength>'
            '<D:getcontenttype>'  (esc:ul type.u.it)  '</D:getcontenttype>'
            '<D:getetag>'  (esc:ul (etag:ul data.u.it))  '</D:getetag>'
        ==
      %+  rap  3
      :~  '<D:response><D:href>'  (esc:ul (dav-href app q k))
          '</D:href><D:propstat><D:prop><D:displayname>'  (esc:ul name)
          '</D:displayname>'  props
          '<D:getlastmodified>'  (rfc1123:ul ms)  '</D:getlastmodified>'
          '<D:creationdate>'  (iso:ul ms)  '</D:creationdate>'
          '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
      ==
    %-  done
    %+  xml:ul  207
    %+  rap  3
    :~  '<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">'
        (rap 3 resp)
        '</D:multistatus>'
    ==
  ::
  ++  proppatch
    ^-  bound
    =/  href  (rap 3 '/utilities/dav/' app '/' (encode-path:ul p) ~)
    %-  done
    %+  xml:ul  207
    %+  rap  3
    :~  '<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:"><D:response>'
        '<D:href>'  (esc:ul href)  '</D:href><D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status>'
        '</D:propstat></D:response></D:multistatus>'
    ==
  ::
  ::  +destination: [app path] from the Destination header (url or path)
  ::
  ++  destination
    ^-  (unit [@t @t])
    =/  d=@t  (fall (header:ul 'destination' hed) '')
    =/  sch  (find "://" (trip d))
    =?  d  ?=(^ sch)
      =/  rest=@t  (tail:ul (add 3 u.sch) d)
      =/  sl  (find "/" (trip rest))
      ?~(sl '' (tail:ul u.sl rest))
    =/  hs  (find "#" (trip d))
    =?  d  ?=(^ hs)  (end [3 u.hs] d)
    =/  qs  (find "?" (trip d))
    =?  d  ?=(^ qs)  (end [3 u.qs] d)
    =.  d  (decode:ul d |)
    =/  pre  '/utilities/dav/'
    ?.  (starts:ul pre d)  ~
    =/  rest  (tail:ul (met 3 pre) d)
    =/  sl  (find "/" (trip rest))
    ?~  sl  ~
    =/  dapp  (end [3 u.sl] rest)
    ?.  (sane-app:ul dapp)  ~
    =/  dp  (tail:ul +(u.sl) rest)
    =/  dps  (rip 3 dp)
    |-  ^-  (unit [@t @t])
    ?:  &(?=(^ dps) =('/' i.dps))  $(dps t.dps)
    =.  dps  (flop dps)
    |-  ^-  (unit [@t @t])
    ?:  &(?=(^ dps) =('/' i.dps))  $(dps t.dps)
    `[dapp (rap 3 (flop dps))]
  ::
  ++  copy
    |=  move=?
    ^-  bound
    =/  dst  destination
    ?~  dst  (done (text:ul 400 'bad destination'))
    =/  [dapp=@t dp=@t]  u.dst
    ?~  (dav-kind app p)  (done (text:ul 404 'not found'))
    =/  exists  ?=(^ (dav-kind dapp dp))
    =/  ow  (crip (cuss (trip (fall (header:ul 'overwrite' hed) 'T'))))
    ?:  &(exists =('F' ow))  (done (text:ul 412 'precondition failed'))
    =?  store  exists  (del-tree dapp dp)
    =/  pre  (cat 3 p '/')
    =/  src=(list [@t item])
      %+  skim  ~(tap by (items app))
      |=([k=@t *] |(=(k p) (starts:ul pre k)))
    =/  now  now-ms
    |-  ^-  bound
    ?~  src
      [(blank:ul ?:(exists 204 201)) ~ state]
    =/  [k=@t it=item]  i.src
    =.  store  (put-item dapp (cat 3 dp (tail:ul (met 3 p) k)) it(modified now))
    =?  store  move  (del-item app k)
    $(src t.src)
  ::
  ++  lock
    ^-  bound
    =/  tok  (crip "opaquelocktoken:{((x-co:co 40) (end [3 20] eny.bowl))}")
    :_  [~ state]
    :-  :-  200
        :~  ['content-type' 'application/xml; charset=utf-8']
            ['lock-token' (rap 3 '<' tok '>' ~)]
        ==
    %-  some
    %-  as-octs:mimes:html
    %+  rap  3
    :~  '<?xml version="1.0" encoding="utf-8"?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>'
        '<D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope>'
        '<D:depth>infinity</D:depth><D:timeout>Second-3600</D:timeout>'
        '<D:locktoken><D:href>'  tok  '</D:href></D:locktoken></D:activelock></D:lockdiscovery></D:prop>'
    ==
  --
--
