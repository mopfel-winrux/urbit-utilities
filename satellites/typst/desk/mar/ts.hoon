::  raw bytes served as text/plain
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/text/'plain' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
