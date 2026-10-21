#!/bin/sh
# make staging REF=<branch>: a self-built staging botdot server (docs/install-linux.md) moved to another
# branch of its source. It checks the disk, takes the branch (fetch, checkout, pull), builds both images
# (make images) and runs the installer with them, the same path as a normal update: accounts, data and
# passkeys stay. Images named without a registry are what make images built, so nothing is downloaded.
#
# STAGING_MIN_GB (default 15) is the free space below which it stops before building, STAGING_WARN_GB
# (default 25) the one below which it warns, in the Docker data folder and in BOT_DOT_DIR.
set -eu

REF="${1:-}"
if [ -z "$REF" ]; then
  echo "Name the branch: make staging REF=<branch>" >&2
  exit 1
fi
MIN_GB="${STAGING_MIN_GB:-15}"
WARN_GB="${STAGING_WARN_GB:-25}"
SERVER_IMAGE="${SERVER_IMAGE:-bot-dot/server:latest}"
COMPUTER_IMAGE="${COMPUTER_IMAGE:-bot-dot/desktop:latest}"

cd "$(dirname "$0")/.."

# A checkout owned by someone else is run by git as its owner: git refuses one it doesn't own (safe.directory).
owner="$(stat -c %U .git 2>/dev/null || echo)"
if [ "$(id -u)" = 0 ] && [ -n "$owner" ] && [ "$owner" != root ] && command -v sudo >/dev/null 2>&1; then
  g() { sudo -u "$owner" git "$@"; }
else
  g() { git "$@"; }
fi

# The heavy build and the installer's copies of the images need room; stop before starting what can't finish.
docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
for where in "$docker_root" "${BOT_DOT_DIR:-/var/lib/botdot}"; do
  [ -e "$where" ] || continue
  free_gb="$(df -Pk "$where" | awk 'NR == 2 { printf "%d", $4 / 1048576 }')"
  [ -n "$free_gb" ] || continue
  if [ "$free_gb" -lt "$MIN_GB" ]; then
    echo "Only $free_gb GB free on $where: building the images needs at least $MIN_GB GB (STAGING_MIN_GB). Free some space (sudo docker system prune) and run this again." >&2
    exit 1
  fi
  if [ "$free_gb" -lt "$WARN_GB" ]; then
    echo "Warning: only $free_gb GB free on $where; the build may run out of space below $WARN_GB GB."
  fi
done

if [ -n "$(g status --porcelain --untracked-files=no)" ]; then
  echo "The checkout has changes of its own: commit or undo them first, so the branch builds as it is on GitHub." >&2
  exit 1
fi

g fetch origin
g checkout "$REF"
g pull --ff-only origin "$REF"
echo "Building $REF at $(g rev-parse --short HEAD)."

"${MAKE:-make}" images SERVER_IMAGE="$SERVER_IMAGE" COMPUTER_IMAGE="$COMPUTER_IMAGE"
BOT_DOT_IMAGE="$SERVER_IMAGE" BOT_DOT_COMPUTER_IMAGE="$COMPUTER_IMAGE" sh install.sh
