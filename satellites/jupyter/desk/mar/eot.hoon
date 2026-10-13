::  raw bytes served as application/vnd.ms-fontobject
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/application/'vnd.ms-fontobject' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
