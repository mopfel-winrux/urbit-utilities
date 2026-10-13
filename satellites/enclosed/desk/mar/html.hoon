::  raw bytes served as text/html
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/text/'html' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
