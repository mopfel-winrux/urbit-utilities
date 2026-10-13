::  raw bytes served as image/x-icon
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/image/'x-icon' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
