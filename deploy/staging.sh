#!/bin/sh
# make staging REF=<branch>: a self-built staging botdot server (docs/install-linux.md) moved to another
# branch of its source. It checks the disk, takes the branch (fetch, checkout, pull), builds both images
# (make images) and runs the installer with them, the same path as a normal update: accounts, data and
# passkeys stay. Images named without a registry are what make images built, so nothing is downloaded.
#
# After the installer ended well it cleans up after itself, in the machine's Docker: the image that ran before
# becomes <repository>:previous (for a rollback: docker tag bot-dot/server:previous bot-dot/server:latest and
# rerun install.sh), every other image of the two repositories and every nameless one make images built goes,
# never forced (one a container still uses stays), and the build cache is trimmed. A failed build or install
# removes nothing. Each account's Docker keeps only the image it runs: the installer removes the rest there.
#
# STAGING_MIN_GB (default 15) is the free space below which it stops before building, STAGING_WARN_GB
# (default 25) the one below which it warns, in the Docker data folder and in BOT_DOT_DIR. STAGING_CACHE_GB
# (default 15, about one full build) is the build cache it keeps, so the next build stays fast.
set -eu

REF="${1:-}"
if [ -z "$REF" ]; then
  echo "Name the branch: make staging REF=<branch>" >&2
  exit 1
fi
MIN_GB="${STAGING_MIN_GB:-15}"
WARN_GB="${STAGING_WARN_GB:-25}"
CACHE_GB="${STAGING_CACHE_GB:-15}"
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

# image_id REF: the id of the image REF names in the machine's Docker, or nothing.
image_id() { docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true; }
# repository REF: REF without its tag (a registry's port stays).
repository() {
  case "${1##*/}" in *:*) echo "${1%:*}" ;; *) echo "$1" ;; esac
}
free_kb() { df -Pk "$docker_root" 2>/dev/null | awk 'NR == 2 { print $4 }'; }

# The images that run now get a name of their own first: a build that takes their tag may otherwise drop them
# (Docker's containerd image store does), and a failed deploy keeps them under it. After a failed deploy that
# name already holds what ran before it, not the build that failed, so it stays.
for image in "$SERVER_IMAGE" "$COMPUTER_IMAGE"; do
  [ -z "$(image_id "$image")" ] || [ -n "$(image_id "$(repository "$image"):before-deploy")" ] || docker tag "$image" "$(repository "$image"):before-deploy"
done

"${MAKE:-make}" images SERVER_IMAGE="$SERVER_IMAGE" COMPUTER_IMAGE="$COMPUTER_IMAGE"
BOT_DOT_IMAGE="$SERVER_IMAGE" BOT_DOT_COMPUTER_IMAGE="$COMPUTER_IMAGE" sh install.sh

# Only after the installer ended well: the image that ran before is the previous one, and what is older goes.
before_kb="$(free_kb)"
# tidy REF: REF's repository keeps REF and its previous image, the one REF named before this deploy.
tidy() {
  repo="$(repository "$1")"
  now="$(image_id "$1")"
  was="$(image_id "$repo:before-deploy")"
  old="$(image_id "$repo:previous")"
  # Without its previous tag the image that ran before would look old: nothing of this repository goes then.
  if [ -n "$was" ] && [ "$was" != "$now" ]; then docker tag "$repo:before-deploy" "$repo:previous" || return 0; fi
  prev="$(image_id "$repo:previous")"
  docker image ls --no-trunc --format '{{.Repository}}:{{.Tag}} {{.ID}}' "$repo" 2>/dev/null | while read -r ref id; do
    case "$ref" in *:\<none\>) ref="$id" ;; esac
    # The before-deploy name always goes (the image keeps its other name); every other old image of REF goes.
    if [ "$ref" = "$repo:before-deploy" ] || { [ "$id" != "$now" ] && [ "$id" != "$prev" ]; }; then
      docker image rm "$ref" >/dev/null 2>&1 || true
    fi
  done
  # The previous image before this one has no name left (and, from before the label, nothing to find it by).
  if [ -n "$old" ] && [ "$old" != "$now" ] && [ "$old" != "$prev" ]; then docker image rm "$old" >/dev/null 2>&1 || true; fi
}
count() { docker image ls -q --no-trunc 2>/dev/null | sort -u | wc -l; }
had="$(count)"
tidy "$SERVER_IMAGE"
tidy "$COMPUTER_IMAGE"
# Nameless images make images built (its label): an earlier build of either. One a container uses stays.
for id in $(docker image ls -q --no-trunc --filter dangling=true --filter label=dev.botdot.self-built=true 2>/dev/null); do
  docker image rm "$id" >/dev/null 2>&1 || true
done
removed=$((had - $(count)))
docker builder prune --all --force --keep-storage "${CACHE_GB}gb" >/dev/null 2>&1 || echo "Warning: couldn't trim the build cache."
after_kb="$(free_kb)"
freed="$(awk -v a="${before_kb:-0}" -v b="${after_kb:-0}" 'BEGIN { d = (b - a) / 1048576; printf "%.1f", d < 0 ? 0 : d }')"
echo "Removed $removed old image$( [ "$removed" = 1 ] || echo s) and trimmed the build cache to $CACHE_GB GB: $freed GB freed. Kept $SERVER_IMAGE, $COMPUTER_IMAGE and their previous images."
