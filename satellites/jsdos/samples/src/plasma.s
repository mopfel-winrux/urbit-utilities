# PLASMA.COM - tiny animated VGA (mode 13h) XOR pattern for testing js-dos.
# Written for the vert-urbit jsdos satellite; released under CC0-1.0 (public domain).
# Press any key to exit.
        .code16
        .text
        .globl _start
_start:
        mov     $0x0013, %ax        # VGA 320x200x256
        int     $0x10
        mov     $0xA000, %ax
        mov     %ax, %es
        xor     %bp, %bp            # frame counter
frame:
        mov     $0x3DA, %dx         # wait for vertical retrace
1:      in      %dx, %al
        test    $8, %al
        jnz     1b
2:      in      %dx, %al
        test    $8, %al
        jz      2b
        xor     %di, %di
        xor     %si, %si            # y
row:    xor     %bx, %bx            # x
col:    mov     %bx, %ax            # colour = (x xor y) + frame
        xor     %si, %ax
        add     %bp, %ax
        stosb
        inc     %bx
        cmp     $320, %bx
        jb      col
        inc     %si
        cmp     $200, %si
        jb      row
        inc     %bp
        mov     $1, %ah             # key pressed?
        int     $0x16
        jz      frame
        xor     %ah, %ah            # eat the key
        int     $0x16
        mov     $0x0003, %ax        # back to text mode
        int     $0x10
        mov     $msg, %dx
        mov     $9, %ah
        int     $0x21
        ret
msg:    .ascii  "PLASMA.COM: bye (CC0)\r\n$"
