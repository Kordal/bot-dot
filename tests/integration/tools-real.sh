#!/usr/bin/env bash
# `make tools-real`, run when a change touches how a bot's tools are installed:
# the real micromamba, the one the Dockerfile pins, installs jq from conda-forge for one bot through the
# privilege broker, in a container from the image's base with the flags of compose.yaml. That bot runs
# it and cannot change it; another bot cannot run it; a wrong sha256 installs nothing (ADR 007).
# Then the same once more the second way of installing, which a Mac-hosted botdot needs: the copy onto the
# data folder is refused (here by a stand-in before the real micromamba, since a Docker volume takes it), and
# the real micromamba hard-links from a cache on the data folder that is gone when the install ends.
#
# It needs Docker and the network. Without either it says so and passes: the task gate never runs it.
set -euo pipefail

cd "$(dirname "$0")/../.."

skip() { echo "tools-real skipped: $1"; exit 0; }
DOCKER="${DOCKER:-docker}"
command -v "$DOCKER" >/dev/null 2>&1 || skip "Docker is not installed"
"$DOCKER" info >/dev/null 2>&1 || skip "Docker is not running"
curl -fsS -m 20 -o /dev/null "https://api.anaconda.org/package/conda-forge/jq" || skip "the registry (anaconda.org) cannot be reached"

arg() { sed -n "s/^ARG $1=//p" Dockerfile; }
NODE_IMAGE="$(arg NODE_IMAGE)"
LLAMA_IMAGE="$(arg LLAMA_IMAGE)"
[ -n "$NODE_IMAGE" ] && [ -n "$LLAMA_IMAGE" ] || { echo "tools-real: the Dockerfile no longer names NODE_IMAGE and LLAMA_IMAGE"; exit 1; }

tag="botdot-tools-real-$$"
cleanup() {
	"$DOCKER" volume rm -f "$tag" >/dev/null 2>&1 || true
	"$DOCKER" image rm -f "$tag" "$tag-micromamba" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# The pinned micromamba of this machine's architecture: the Dockerfile's own stage, so its checksum is checked.
"$DOCKER" build -q --target micromamba -t "$tag-micromamba" . >/dev/null
# The image's base with Node and that micromamba, and nothing else of botdot's image (no model, no Claude Code).
# The base brings curl and the CA certificates itself (the installer trial of 2026-10-03 ran on it as it is).
"$DOCKER" build -q -t "$tag" - >/dev/null <<DOCKERFILE
FROM $NODE_IMAGE AS node
FROM $tag-micromamba AS micromamba
FROM $LLAMA_IMAGE
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=micromamba --chown=60400:60400 --chmod=0550 /micromamba /usr/local/bin/micromamba
DOCKERFILE

# The data folder is a Docker volume, as on a Linux botdot server; the flags are those of compose.yaml.
"$DOCKER" volume create "$tag" >/dev/null
"$DOCKER" run --rm \
	--cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add SETGID --cap-add SETUID --cap-add KILL \
	--security-opt no-new-privileges:true \
	-v "$PWD:/opt/bot-dot:ro" -v "$tag:/data" \
	--entrypoint /usr/local/bin/node "$tag" /opt/bot-dot/tests/integration/tools-real.js
