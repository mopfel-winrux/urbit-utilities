::  configuration for the %emulatorjs-fileserver agent
::
|%
::  serve /web from this desk under /emulatorjs
::
++  web-root  ^-  (list @t)  /emulatorjs
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
