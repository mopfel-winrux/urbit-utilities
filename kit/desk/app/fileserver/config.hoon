::  configuration for the %SATELLITE-fileserver agent
::
|%
::  serve /web from this desk under /SATELLITE
::
++  web-root  ^-  (list @t)  /SATELLITE
::  extensionless urls fall back to dir/index.html ...
::
++  extension  %fall
::  ... and, if spa is &, to the root index.html (history-routing apps)
::
++  spa  ^-  ?  SPA
::  local login required (| = public, or [default (list [path ?])])
::
++  auth  ^-  $@(? [? (list [path ?])])  AUTH
--
