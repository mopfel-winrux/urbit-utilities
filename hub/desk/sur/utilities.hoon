::  %utilities: types
::
|%
::  $item: one stored blob, keyed by (app, path)
::
::    .modified and .expires are unix ms, like the HTTP API.
::    .dir marks an (empty) WebDAV collection created by MKCOL.
::
+$  item
  $:  type=@t
      data=octs
      modified=@ud
      public=?
      burn=?
      expires=(unit @ud)
      dir=?
  ==
::  $state-0
::
::    .store: app -> path -> item
::    .publisher: override for the ship satellites install from
::    .pending: desks we asked kiln to install, and when
::
+$  state-0
  $:  %0
      store=(map @t (map @t item))
      publisher=(unit ship)
      pending=(map desk @da)
  ==
--
