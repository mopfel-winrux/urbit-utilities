::  raw bytes served as application/manifest+json
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/application/'manifest+json' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
