::  raw bytes served as application/javascript
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/application/'javascript' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
