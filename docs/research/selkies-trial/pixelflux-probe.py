#!/usr/bin/env python3
"""Does pixelflux (Selkies' capture and encode library) capture this computer's screen under gVisor? (#1737)

This is the two-minute test that decides the trial: no Selkies server, no browser, nothing that listens. It captures
one X display with the software H.264 encoder for a still phase and a moving phase, and prints what path the capture
took (`stream_info`), the frames, bytes, the encoder's time per frame, and the CPU the probe itself used.

  python3 -m venv /tmp/pf && /tmp/pf/bin/pip install pixelflux==2.2.3
  DISPLAY=:11 /tmp/pf/bin/python pixelflux-probe.py [still seconds] [moving seconds]

The still phase comes first on a screen nothing moves on, so run the probe before `pattern.py`: the probe starts
`pattern.py` (beside it) itself between the two phases and stops it at the end, so the still figure is a still screen's.
PATTERN=0 starts nothing, for a pattern you run yourself. Exit 0 when XShm worked and frames arrived, 2 when the
capture failed or delivered nothing: then read the printed error, it names the step (shmget, shmat, shm_attach, XShm
unavailable, a 32-bit root).
"""
import os
import resource
import signal
import subprocess
import sys
import time

from pixelflux import CaptureSettings, ScreenCapture

STILL = float(sys.argv[1]) if len(sys.argv) > 1 else 8.0
MOVING = float(sys.argv[2]) if len(sys.argv) > 2 else 15.0
W, H = int(os.environ.get("W", "1280")), int(os.environ.get("H", "800"))

frames, nbytes, encode_ms, pipeline_ms, ids = 0, 0, 0.0, 0.0, set()


def callback(frame):
    global frames, nbytes, encode_ms, pipeline_ms
    n = len(frame)
    if n == 0:
        return
    nbytes += n
    if frame.frame_id not in ids:
        ids.add(frame.frame_id)
        frames += 1
        encode_ms += (frame.encode_end_ns - frame.encode_start_ns) / 1e6
        pipeline_ms += (frame.encode_end_ns - frame.capture_ns) / 1e6


def cpu():
    r = resource.getrusage(resource.RUSAGE_SELF)
    return r.ru_utime + r.ru_stime


def phase(name, seconds):
    global frames, nbytes, encode_ms, pipeline_ms
    ids.clear()
    frames, nbytes, encode_ms, pipeline_ms = 0, 0, 0.0, 0.0
    c0, t0 = cpu(), time.monotonic()
    time.sleep(seconds)
    dt, dc = time.monotonic() - t0, cpu() - c0
    f = max(frames, 1)
    print(f"{name:7s} {dt:5.1f}s  {frames / dt:6.1f} frames/s  {nbytes * 8 / dt / 1000:8.0f} kbit/s  "
          f"encode {encode_ms / f:5.1f} ms/frame  capture-to-encoded {pipeline_ms / f:5.1f} ms  "
          f"cpu {100 * dc / dt:5.1f} % of one core  rss {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024:.0f} MB")
    return frames


settings = CaptureSettings()
settings.capture_width, settings.capture_height = W, H
settings.capture_x, settings.capture_y = 0, 0
settings.auto_adjust_screen_capture_size = False
settings.codec = "h264"
settings.video_fullframe = True      # one picture a frame: what a WebCodecs decoder in a page takes
settings.use_cpu = True              # no GPU here; skip the probe of /dev/dri
settings.target_fps = 30.0
settings.video_crf = 28
capture = ScreenCapture()
try:
    capture.start_capture(callback, settings)
except Exception as e:  # the message names the failing step
    print(f"FAIL  start_capture: {e}")
    sys.exit(2)
time.sleep(3)  # the first key frame, and the capture's own set-up
print("stream_info:", capture.stream_info())
still = phase("still", STILL)
pattern = None
if os.environ.get("PATTERN", "1") != "0":
    pattern = subprocess.Popen([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "pattern.py")])
    print("-- the moving pattern started (pattern.py) --", flush=True)
else:
    print("-- PATTERN=0: start the moving pattern now (DISPLAY=... python3 pattern.py) --", flush=True)
time.sleep(3)
try:
    moving = phase("moving", MOVING)
finally:
    if pattern:
        pattern.send_signal(signal.SIGTERM)
        pattern.wait()
print("stream_stats:", capture.stream_stats())
capture.stop_capture()
if not moving:
    print("FAIL  no frames in the moving phase")
    sys.exit(2)
print("PASS  XShm capture delivered frames; the path above says which one it took")
