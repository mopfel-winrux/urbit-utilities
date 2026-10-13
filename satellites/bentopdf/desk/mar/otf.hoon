::  raw bytes served as font/otf
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/font/'otf' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
