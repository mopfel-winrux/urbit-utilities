::  raw bytes served as image/jpeg
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/image/'jpeg' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
