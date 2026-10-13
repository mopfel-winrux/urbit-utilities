::  raw bytes served as application/gzip
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/application/'gzip' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
