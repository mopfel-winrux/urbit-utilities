::  raw bytes served as application/wasm
::
|_  dat=octs
++  grow
  |%
  ++  mime  [/application/'wasm' dat]
  --
++  grab
  |%
  ++  mime  |=([p=mite q=octs] q)
  ++  noun  octs
  --
++  grad  %mime
--
