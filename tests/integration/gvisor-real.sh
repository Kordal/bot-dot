#!/usr/bin/env bash
# `make gvisor-real`, the spike of ADR 028 (#464): one account's botdot under gVisor. In a nested, rootless Docker
# daemon whose every container runs under runsc (a pinned gVisor release, on a machine without nested
# virtualisation), botdot's real server and its real bots' computer start; botdot's identity check tells the
# Chief, a bot and the tools user apart; the bot's desktop and its live screen answer; Camoufox and its bridge run
# as `browser` and a secret reaches only the bridge; and the account's footprint is measured
# (tests/integration/gvisor-real.js has the steps).
#
# It needs Docker, able to run a privileged container, and the network for the base images and gVisor. Without
# Docker, or where gVisor cannot start a sandbox on this Docker, it says so and passes outside CI.
set -euo pipefail

cd "$(dirname "$0")/../.."

# In CI a stage that cannot run fails instead of passing.
skip() { if [ -n "${CI:-}" ]; then echo "gvisor-real: $1"; exit 1; fi; echo "gvisor-real skipped: $1"; exit 0; }
DOCKER="${DOCKER:-docker}"
command -v "$DOCKER" >/dev/null 2>&1 || skip "Docker is not installed"
"$DOCKER" info >/dev/null 2>&1 || skip "Docker is not running"
case "$("$DOCKER" info --format '{{.Architecture}}')" in
	x86_64 | amd64 | aarch64 | arm64) ;;
	*) skip "gVisor runs on x86_64 and arm64 only" ;;
esac

node tests/integration/gvisor-real.js
