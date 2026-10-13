::  configuration for the %vert-fileserver agent (see app/vert-fileserver.hoon)
::
|%
::  serve /web from this desk under /vert
::
++  web-root  ^-  (list @t)  /vert
::  extensionless urls fall back to the index file,
::  so /vert/convert serves /web/convert/index.html
::
++  extension  %fall
::  local login required (set to | to make the files public)
::
++  auth  ^-  ?  &
--
