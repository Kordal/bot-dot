#!/usr/bin/env python3
"""A moving test pattern on an X display, the same load for every transport (#1737, trial only).

Opens one window with eight coloured boxes sliding at different speeds and a line of text that counts frames and shows the computer's wall clock to the millisecond (the latency test reads it
beside the viewer's own clock), redrawn
about 30 times a second, so a stream has something to encode that a still desktop has not. It uses libX11 through
ctypes (the desktop has it: Firefox needs it), so nothing is installed. Stop it with Ctrl+C or `kill`.

  DISPLAY=:11 python3 pattern.py [seconds]      (default: until stopped)
"""
import ctypes
import ctypes.util
import datetime
import sys
import time

x11 = ctypes.CDLL(ctypes.util.find_library("X11") or "libX11.so.6")
P, UL, I, U = ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_uint
x11.XOpenDisplay.restype, x11.XOpenDisplay.argtypes = P, [ctypes.c_char_p]
x11.XDefaultScreen.restype, x11.XDefaultScreen.argtypes = I, [P]
x11.XRootWindow.restype, x11.XRootWindow.argtypes = UL, [P, I]
x11.XCreateSimpleWindow.restype = UL
x11.XCreateSimpleWindow.argtypes = [P, UL, I, I, U, U, U, UL, UL]
x11.XMapWindow.argtypes = [P, UL]
x11.XCreateGC.restype, x11.XCreateGC.argtypes = P, [P, UL, UL, P]
x11.XSetForeground.argtypes = [P, P, UL]
x11.XFillRectangle.argtypes = [P, UL, P, I, I, U, U]
x11.XDrawString.argtypes = [P, UL, P, I, I, ctypes.c_char_p, I]
x11.XClearWindow.argtypes = [P, UL]
x11.XFlush.argtypes = [P]

W, H = 1000, 640
dpy = x11.XOpenDisplay(None)
if not dpy:
    sys.exit("pattern.py: no X display (set DISPLAY, for example DISPLAY=:11)")
screen = x11.XDefaultScreen(dpy)
win = x11.XCreateSimpleWindow(dpy, x11.XRootWindow(dpy, screen), 100, 60, W, H, 0, 0, 0x101820)
gc = x11.XCreateGC(dpy, win, 0, None)
x11.XMapWindow(dpy, win)
colours = [0xE74C3C, 0xF1C40F, 0x2ECC71, 0x3498DB, 0x9B59B6, 0x1ABC9C, 0xE67E22, 0xECF0F1]
end = time.monotonic() + float(sys.argv[1]) if len(sys.argv) > 1 else None
frame = 0
while end is None or time.monotonic() < end:
    t0 = time.monotonic()
    x11.XClearWindow(dpy, win)
    for i, colour in enumerate(colours):
        x = (frame * (3 + i) * 2) % (W - 80)
        y = 20 + i * 70
        x11.XSetForeground(dpy, gc, colour)
        x11.XFillRectangle(dpy, win, gc, x, y, 80, 50)
    x11.XSetForeground(dpy, gc, 0xFFFFFF)
    now = datetime.datetime.now()
    text = f"frame {frame}   wall clock {now:%H:%M:%S}.{now.microsecond // 1000:03d}".encode()
    x11.XDrawString(dpy, win, gc, 20, H - 20, text, len(text))
    x11.XFlush(dpy)
    frame += 1
    time.sleep(max(0.0, 1 / 30 - (time.monotonic() - t0)))
