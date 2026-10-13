::  raw bytes served as application/vnd.iccprofile
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/application/'vnd.iccprofile' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
