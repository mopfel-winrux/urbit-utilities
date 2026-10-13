::  raw bytes served as application/octet-stream
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/application/'octet-stream' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
