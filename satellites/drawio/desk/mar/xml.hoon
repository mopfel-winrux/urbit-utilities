::  raw bytes served as application/xml
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/application/'xml' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
