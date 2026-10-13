Office satellite: third-party components and licenses
======================================================

soffice.js, soffice.wasm(.gz), soffice.data(.gz), soffice.data.js.metadata
  ZetaOffice, a build of LibreOffice for WebAssembly ("LOWA") by allotropia
  software GmbH, downloaded unmodified from
  https://cdn.zetaoffice.net/zetaoffice_latest/ (build of 2025-05-13; the
  exact SHA-256 sums are pinned in build.sh). The .gz files are the same
  bytes, gzip-compressed for storage; the service worker decompresses them.
  License: Mozilla Public License 2.0 (mpl-2.0.txt); LibreOffice also
  contains third-party code under MPL-compatible licenses, listed in the
  product's own About / License dialog (Help menu).
  Source code (MPL-2.0 section 3.2):
    https://git.libreoffice.org/core/+/refs/heads/distro/allotropia/zeta-24-2
    https://github.com/allotropia/emscripten/commits/fixed-3.1.65
    https://github.com/allotropia/qt5/tree/5.15.2%2Bwasm
    https://github.com/allotropia/qtbase/tree/5.15.2%2Bwasm

zeta.js
  zetajs 1.2.0, https://github.com/allotropia/zetajs (npm "zetajs").
  License: MIT (zetajs-mit.txt).

index.html, app.js, office_thread.js, sw.js, icon.svg
  This satellite's own code. License: MIT.
