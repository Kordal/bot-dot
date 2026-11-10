#!/bin/sh
# botdot in one line: curl -fsSL https://raw.githubusercontent.com/Kordal/bot-dot/main/get.sh | sudo sh
# The same as the two lines in the README: it puts botdot's source in ./bot-dot-source (yours, not root's, so
# `git -C bot-dot-source pull` updates it later) and runs the install.sh in it, which asks its questions on the
# terminal. All in one function, called on the last line, so a cut-off download runs nothing.
set -eu

botdot_get() {
  [ "$(id -u)" = 0 ] || { echo "Run it with sudo: curl -fsSL https://raw.githubusercontent.com/Kordal/bot-dot/main/get.sh | sudo sh" >&2; exit 1; }
  # The person who typed sudo owns the source, as when they clone it themselves.
  as_owner() { if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then sudo -u "$SUDO_USER" -H "$@"; else "$@"; fi; }
  if ! command -v git >/dev/null 2>&1; then
    echo "Installing git"
    if command -v apt-get >/dev/null 2>&1; then apt-get update -qq </dev/null && apt-get install -y -qq git </dev/null
    elif command -v dnf >/dev/null 2>&1; then dnf install -y -q git </dev/null
    else echo "botdot needs git: install it, then run this again." >&2; exit 1; fi
  fi
  if [ -d bot-dot-source/.git ]; then
    echo "Updating botdot's source in $(pwd)/bot-dot-source"
    as_owner git -C bot-dot-source pull --ff-only </dev/null
  else
    echo "Getting botdot's source into $(pwd)/bot-dot-source"
    as_owner git clone --quiet https://github.com/Kordal/bot-dot.git bot-dot-source </dev/null
  fi
  # This script came in on standard input: the installer gets the terminal instead, for its questions.
  if [ -r /dev/tty ] && (: </dev/tty) 2>/dev/null; then exec sh bot-dot-source/install.sh "$@" </dev/tty; fi
  exec sh bot-dot-source/install.sh "$@" </dev/null
}

botdot_get "$@"
