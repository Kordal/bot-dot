# syntax=docker/dockerfile:1
# A TRIAL layer, not part of the desktop image (#1737, docs/research/2026-11-25-selkies-as-the-screens-transport.md):
# Selkies 2.2.1 (the latest stable release, 2026-11-04) on top of botdot's desktop image, for a throwaway computer.
# Nothing here is built by botdot or CI. Build it by hand, on the machine that holds the desktop image:
#
#   docker build -f selkies-trial.Dockerfile --build-arg DESKTOP=bot-dot/desktop:latest -t bot-dot/desktop:selkies-trial .
#
# The .deb is the release's own, pinned by the sha256 its SHA256SUMS publishes. It brings a Python 3.12 virtualenv in
# /opt/selkies with pixelflux 2.2.3 (the capture and encode library, Rust) inside, and /usr/bin/selkies.
ARG DESKTOP=bot-dot/desktop:latest
FROM scratch AS selkies-amd64
ADD --checksum=sha256:4bc87969acf45951fbf6148b9d7e23717df58411e5a47d361b99b78842caaa8c \
    https://github.com/selkies-project/selkies/releases/download/2.2.1/selkies-2.2.1-ubuntu24.04-amd64.deb /selkies.deb
FROM scratch AS selkies-arm64
ADD --checksum=sha256:dd9564100900cbbd2fe8cd7695c0a211a8c6abc32f2932c15dcfd631ac382dec \
    https://github.com/selkies-project/selkies/releases/download/2.2.1/selkies-2.2.1-ubuntu24.04-arm64.deb /selkies.deb
FROM selkies-${TARGETARCH} AS selkies

FROM ${DESKTOP}
USER root
# apt resolves the .deb's own dependencies (libva, libgbm, libegl1, libxcb-shm0, libpulse0 ...), which the base may lack.
# x11-utils and x11-xserver-utils give xdpyinfo, xrandr and xrdb, which the probe and the checks use and the base may lack.
RUN --mount=type=bind,from=selkies,source=/selkies.deb,target=/tmp/selkies.deb \
    apt-get update \
 && apt-get install -y --no-install-recommends /tmp/selkies.deb x11-utils x11-xserver-utils \
 && rm -rf /var/lib/apt/lists/* \
 && test -x /usr/bin/selkies
# The probe and the trial scripts, for the same place on every computer.
COPY pattern.py pixelflux-probe.py run-selkies.sh measure.py /opt/selkies-trial/
RUN chmod 755 /opt/selkies-trial/*.sh
# The user stays as the desktop image leaves it: a computer runs as box by `docker run --user` (lib/computers.js).
