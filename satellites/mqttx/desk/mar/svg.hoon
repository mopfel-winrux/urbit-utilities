::  raw bytes served as image/svg+xml
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/image/'svg+xml' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
