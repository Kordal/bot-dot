#!/usr/bin/env bash
# `make image-cleanup-real`, run when a change touches updates or the image cleanup: a machine of two accounts (ADR 028)
# in a nested Docker daemon is updated three times, by install.sh and by the admin page's Update (#473); the front door
# and both accounts run the new release each time, and the images no Docker uses any more are gone, while a stopped
# bot's computer with its file and an unrelated workload stay. A release signed with another key is refused, and the
# admin page says so (tests/integration/image-cleanup-real.js has the steps).
#
# It needs Docker, able to run a privileged container, and the network for the base images. Without
# Docker it says so and passes: the task gate never runs it.
set -euo pipefail

cd "$(dirname "$0")/../.."

skip() { echo "image-cleanup-real skipped: $1"; exit 0; }
DOCKER="${DOCKER:-docker}"
command -v "$DOCKER" >/dev/null 2>&1 || skip "Docker is not installed"
"$DOCKER" info >/dev/null 2>&1 || skip "Docker is not running"

node tests/integration/image-cleanup-real.js
