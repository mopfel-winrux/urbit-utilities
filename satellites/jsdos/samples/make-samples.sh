#!/bin/bash
# Rebuild the test samples from src/plasma.s (needs GNU as/ld). CC0-1.0.
set -euo pipefail
cd "$(dirname "$0")"
as --32 -o /tmp/plasma.$$.o src/plasma.s
ld -m elf_i386 -Ttext=0x100 --oformat=binary -e _start -o src/PLASMA.COM /tmp/plasma.$$.o
rm -f /tmp/plasma.$$.o
python3 - <<'PY'
import zipfile
com = open('src/PLASMA.COM', 'rb').read()
readme = (b'PLASMA.COM - animated VGA test pattern. Press any key to exit.\r\n'
          b'Written for the vert-urbit jsdos satellite. CC0-1.0 (public domain).\r\n')
conf = b'[cpu]\ncycles=auto\n\n[autoexec]\nmount c .\nc:\nPLASMA.COM\n'
def write(name, files):
    with zipfile.ZipFile(name, 'w', zipfile.ZIP_DEFLATED) as z:
        for n, data in files:
            z.writestr(zipfile.ZipInfo(n, (2026, 1, 1, 0, 0, 0)), data, zipfile.ZIP_DEFLATED)
write('plasma.zip', [('PLASMA.COM', com), ('README.TXT', readme)])
write('plasma.jsdos', [('.jsdos/dosbox.conf', conf), ('PLASMA.COM', com), ('README.TXT', readme)])
PY
sha256sum plasma.zip plasma.jsdos
