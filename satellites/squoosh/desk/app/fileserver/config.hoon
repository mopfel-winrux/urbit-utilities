::  configuration for the %squoosh-fileserver agent
::
|%
::  serve /web from this desk under /squoosh
::
++  web-root  ^-  (list @t)  /squoosh
::  extensionless urls fall back to dir/index.html ...
::
++  extension  %fall
::  ... and, if spa is &, to the root index.html (history-routing apps)
::
++  spa  ^-  ?  &
::  local login required (| = public, or [default (list [path ?])])
::
++  auth  ^-  $@(? [? (list [path ?])])  &
--
