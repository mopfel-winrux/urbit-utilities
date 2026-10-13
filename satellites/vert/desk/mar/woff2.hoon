::  raw bytes served as font/woff2
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/font/'woff2' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
