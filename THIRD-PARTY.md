# Third-party code and licences

This repository's own code is MIT-licensed (see `LICENSE`). Everything below
keeps its original licence.

## The apps (satellites)

Each satellite's `build.sh` downloads an upstream app, applies this project's
changes, and builds it. The built apps are not stored in this repository. The
changes to an upstream app (`satellites/<desk>/patches/`, `patch.py`, and any
source files that replace upstream files) are modifications of that app and
are distributed under the upstream app's licence. Each satellite's `NOTES.md`
names the upstream project, the pinned version, its licence, and any
restrictions, including the licences of bundled components (fonts, wasm
builds, emulator cores). The table is a summary; the NOTES are authoritative.

| desk | app | upstream licence |
|---|---|---|
| `vert` | VERT | AGPL-3.0 |
| `bentopdf` | BentoPDF | AGPL-3.0-only |
| `omni-tools` | Omni Tools | MIT (bundled ffmpeg.wasm is GPL-2.0+) |
| `mazanoke` | Mazanoke | GPL-3.0-only |
| `squoosh` | Squoosh | Apache-2.0 |
| `minipaint` | miniPaint | MIT |
| `drawio` | draw.io | Apache-2.0 |
| `fossflow` | FossFLOW | MIT |
| `mermaid` | Mermaid Live | MIT |
| `it-tools` | IT Tools | GPL-3.0 |
| `cyberchef` | CyberChef | Apache-2.0 |
| `nettools` | Networking Toolbox | MIT |
| `sqlime` | Sqlime | MIT |
| `typst` | Typst | MIT (Typst and typst.ts: Apache-2.0; fonts: OFL) |
| `mqttx` | MQTTX Web | Apache-2.0 |
| `snort` | Snort | MIT |
| `nostrudel` | noStrudel | MIT |
| `emulatorjs` | EmulatorJS | GPL-3.0; cores vary, **4 are non-commercial only** |
| `jsdos` | js-dos | GPL-2.0 |
| `excalidraw` | Excalidraw | MIT (fonts: OFL) |
| `superprod` | Super Productivity | MIT |
| `enclosed` | Enclosed | Apache-2.0 |
| `office` | Office | LibreOffice/ZetaOffice: MPL-2.0; zetajs: MIT |
| `jupyter` | JupyterLite | BSD-3-Clause (Pyodide: MPL-2.0) |
| `kiwix` | Kiwix | GPL-3.0-or-later |

## Urbit code

- `kit/desk/app/SATELLITE-fileserver.hoon` (and every generated
  `<desk>-fileserver.hoon`) is derived from Fang-'s foo-fileserver, with a
  single-page-app fallback, Clay-safe file name encoding and fixes added. See
  the original project for its licence.
- `lib/docket.hoon`, `sur/docket.hoon`, `lib/dbug.hoon`,
  `lib/default-agent.hoon`, `lib/skeleton.hoon` and the standard marks come
  from the Urbit codebase (MIT).
