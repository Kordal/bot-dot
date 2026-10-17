#!/usr/bin/env bash
# `make install-real`, run when a change touches what an install runs (install.sh, the compose files, the
# Dockerfile, the docker-helper, the updater, the image workflow): botdot is installed for the first time on a
# clean machine in a nested Docker daemon, with today's installer and stand-in images from a local registry;
# botdot answers and a bot's computer starts and stops (tests/integration/install-real.js has the cases).
# The workflow install.yml runs it on GitHub's machines.
#
# It needs Docker, able to run a privileged container, and the network for the base images. Without
# Docker it says so and passes: the task gate never runs it.
set -euo pipefail

cd "$(dirname "$0")/../.."

# On GitHub's machines (CI) Docker is there: a stage that cannot run fails there instead of passing.
skip() { if [ -n "${CI:-}" ]; then echo "install-real: $1"; exit 1; fi; echo "install-real skipped: $1"; exit 0; }
DOCKER="${DOCKER:-docker}"
command -v "$DOCKER" >/dev/null 2>&1 || skip "Docker is not installed"
"$DOCKER" info >/dev/null 2>&1 || skip "Docker is not running"

node tests/integration/install-real.js
