::  raw bytes served as font/ttf
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/font/'ttf' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
