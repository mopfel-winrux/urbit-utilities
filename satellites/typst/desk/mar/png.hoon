::  raw bytes served as image/png
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/image/'png' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
