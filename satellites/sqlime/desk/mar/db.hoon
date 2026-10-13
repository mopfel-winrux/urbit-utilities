::  raw bytes served as application/vnd.sqlite3
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/application/'vnd.sqlite3' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
