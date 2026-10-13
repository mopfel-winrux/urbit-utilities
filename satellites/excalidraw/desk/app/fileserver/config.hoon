::  configuration for the %excalidraw-fileserver agent
::
|%
::  serve /web from this desk under /excalidraw
::
++  web-root  ^-  (list @t)  /excalidraw
::  extensionless urls fall back to dir/index.html ...
::
++  extension  %fall
::  ... and, if spa is &, to the root index.html (history-routing apps)
::
++  spa  ^-  ?  |
::  login required, except under /excalidraw/view: the read-only viewer for
::  shared drawings and the bundled js, css and fonts (all of them live there)
::
++  auth  ^-  $@(? [? (list [path ?])])  [& ~[[/view |]]]
--
