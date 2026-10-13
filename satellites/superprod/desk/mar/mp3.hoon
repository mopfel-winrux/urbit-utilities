::  raw bytes served as audio/mpeg
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/audio/'mpeg' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
