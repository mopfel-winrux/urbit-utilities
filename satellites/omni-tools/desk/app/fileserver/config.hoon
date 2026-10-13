::  configuration for the %omni-tools-fileserver agent
::
|%
::  serve /web from this desk under /omni-tools
::
++  web-root  ^-  (list @t)  /omni-tools
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
