::  raw bytes served as application/json
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/application/'json' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
