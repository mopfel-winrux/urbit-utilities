::  raw bytes served as text/yaml
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/text/'yaml' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
