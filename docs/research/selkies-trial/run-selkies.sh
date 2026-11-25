#!/bin/sh
# One Selkies for one bot's screen, as box, attached to the screen's own X display (#1737, trial only).
#   run-selkies.sh 11            the first screen of the account's computer (n = 10 + the seat's screen, screenPorts)
# Selkies listens on 127.0.0.1:62nn inside the computer, nothing else: botdot's relay is the way in. Basic auth is off
# because only the computer itself reaches that port, as it reaches the screen's VNC port today (no password,
# -SecurityTypes None). Audio, microphone, webcam, gamepads, printing and file transfers are off: the screen has none.
# Resizing is off: the display stays the 1280x800 botdot made it, which the bots' own screenshots and clicks rely on.
# EXTRA adds or overrides flags, for example EXTRA="--framerate=30,8-60 --rate-control-mode=crf --video-crf=30".
set -eu
N="${1:?the screen's number: 10 plus the seat's screen (11 for the first)}"
PORT=$((6200 + N))
export DISPLAY=":$N"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
LOG="/tmp/selkies-$N.log"
echo "selkies for $DISPLAY on 127.0.0.1:$PORT, log $LOG"
# EXTRA is split on purpose.
# shellcheck disable=SC2086
exec selkies --addr=127.0.0.1 --port="$PORT" --enable-basic-auth=false --enable-https=false \
  --encoder=h264enc --use-cpu=true --enable-resize=false \
  --audio-enabled=false --microphone-enabled=false --webcam-enabled=false --gamepad-enabled=false \
  --printing-enabled=false --file-transfers=none --command-enabled=false \
  ${EXTRA:-} >"$LOG" 2>&1
