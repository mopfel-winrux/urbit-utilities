::  configuration for the %superprod-fileserver agent
::
|%
::  serve /web from this desk under /superprod
::
++  web-root  ^-  (list @t)  /superprod
::  extensionless urls fall back to dir/index.html ...
::
++  extension  %fall
::  ... and, if spa is &, to the root index.html (history-routing apps)
::
++  spa  ^-  ?  |
::  local login required (| = public, or [default (list [path ?])])
::
++  auth  ^-  $@(? [? (list [path ?])])  &
--
