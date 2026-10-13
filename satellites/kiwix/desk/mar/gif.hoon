::  raw bytes served as image/gif
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/image/'gif' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
