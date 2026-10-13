::  raw bytes served as text/css
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/text/'css' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
