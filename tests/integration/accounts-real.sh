#!/usr/bin/env bash
# `make accounts-real` (#467, ADR 028): one machine with two accounts, in a nested Docker daemon. The admin makes a
# sign-up link on the admin page, a second person opens it, root's step makes their account, and the stage proves that
# neither account's bot, Linux user or Docker reaches the other's containers, data folder or socket, and that one's
# session never reaches the other (tests/integration/accounts-real.js has the steps).
#
# It needs Docker, able to run a privileged container, and the network for the base images. Without Docker it says
# so and passes, as install-real does.
set -euo pipefail

cd "$(dirname "$0")/../.."

skip() { if [ -n "${CI:-}" ]; then echo "accounts-real: $1"; exit 1; fi; echo "accounts-real skipped: $1"; exit 0; }
DOCKER="${DOCKER:-docker}"
command -v "$DOCKER" >/dev/null 2>&1 || skip "Docker is not installed"
"$DOCKER" info >/dev/null 2>&1 || skip "Docker is not running"

node tests/integration/accounts-real.js
