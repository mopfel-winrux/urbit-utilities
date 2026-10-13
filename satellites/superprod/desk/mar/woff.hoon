::  raw bytes served as font/woff
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/font/'woff' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
