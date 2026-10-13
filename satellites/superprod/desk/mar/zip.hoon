::  raw bytes served as application/zip
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/application/'zip' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
