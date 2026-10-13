::  raw bytes served as application/x-font-type1
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/application/'x-font-type1' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
