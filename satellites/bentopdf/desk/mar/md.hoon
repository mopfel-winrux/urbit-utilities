::  raw bytes served as text/markdown
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/text/'markdown' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
