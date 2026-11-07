#!/usr/bin/env bash
# `make install-prereqs`: install.sh's first step on a fresh machine of each distribution botdot supports, with the
# real packages (tests/integration/install-prereqs.js). It needs Docker, able to run a privileged container, and the
# network. Without Docker it says so and passes: the task gate never runs it.
set -euo pipefail

cd "$(dirname "$0")/../.."

skip() { if [ -n "${CI:-}" ]; then echo "install-prereqs: $1"; exit 1; fi; echo "install-prereqs skipped: $1"; exit 0; }
command -v docker >/dev/null 2>&1 || skip "Docker is not installed"
docker info >/dev/null 2>&1 || skip "Docker is not running"

node tests/integration/install-prereqs.js
