::  raw bytes served as image/webp
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/image/'webp' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
