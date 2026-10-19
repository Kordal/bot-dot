# botdot desktop: cua's Ubuntu/XFCE computer with Camoufox as the web browser.
# Built automatically by botdot the first time a bot needs a computer.
# Reviewed 2026-09-29; the index contains both amd64 and arm64.
ARG BASE=public.ecr.aws/k5j5w0x5/cua-ubuntu-24.04:docker-latest@sha256:c67f330f287b0e5124f57c64bcf06a7e4b90208186c3036e1312b15d854f6d13
# micromamba 2.9.0, as in botdot's own image: the bot installs programs from conda-forge into its home with it,
# without root (botdot-install, ADR 032). One program per architecture, pinned by the sha256 its release publishes.
FROM scratch AS micromamba-amd64
ADD --checksum=sha256:366cd9cd8be14df1ab8ed50352a82111082a36686b2d389fdb79a92c3fafb3e3 \
    https://github.com/mamba-org/micromamba-releases/releases/download/2.9.0-0/micromamba-linux-64 /micromamba
FROM scratch AS micromamba-arm64
ADD --checksum=sha256:9f93b974adcb4d166996af969b6cd371287d1a3e52733704727884d9b74cb7a7 \
    https://github.com/mamba-org/micromamba-releases/releases/download/2.9.0-0/micromamba-linux-aarch64 /micromamba
FROM micromamba-${TARGETARCH} AS micromamba

FROM ${BASE}
USER root

# The upstream VM-derived filesystem includes a guest kernel. Containers use the host
# kernel: remove its unused boot image, modules, tools and development headers, including
# libc6-dev (which depends on linux-libc-dev). Runtime libc and desktop libraries stay.
RUN dpkg-query -W -f='${binary:Package} ${db:Status-Status}\n' \
    | awk '$2 == "installed" && $1 ~ /^linux-(image|headers|modules|tools|virtual|libc-dev)/ { print $1 }' \
    | xargs -r apt-get purge -y \
 && rm -rf /var/lib/apt/lists/*

# OpenSSH's client: ssh, and the ssh-agent and ssh-add through which run_with_ssh_key lends a bot a saved SSH key
# without showing it (lib/computers.js runWithSshKey, #44), and sudo, which every bot has (ADR 035). Installed
# whether or not the base already has them.
# This step leaves SSH host keys in /etc/ssh (the image's secret scan found them): removed in this same step, so no
# layer keeps private keys every computer would share. No computer runs an SSH server.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-client sudo \
 && rm -f /etc/ssh/ssh_host_*_key /etc/ssh/ssh_host_*_key.pub \
 && rm -rf /var/lib/apt/lists/*

# Fix inherited tar, FastMCP and PyJWT vulnerabilities through their owning applications.
# cua-computer-server 0.3.46 supports FastMCP 3.2; older releases require vulnerable 2.x.
# PyJWT 2.14.0 fixes CVE-2026-102268; it arrives there as a dependency, at 2.13.0.
# proxy-addr 2.0.8 fixes CVE-2026-90711; the base's supergateway brings 2.0.7 with its express.
RUN npm install -g npm@10.9.9 \
 && npm --prefix /usr/lib/node_modules/supergateway install --omit=dev --no-save --no-audit --no-fund 'proxy-addr@2.0.8' \
 && npm --prefix /usr/lib/node_modules/supergateway ls --omit=dev proxy-addr \
 && npm cache clean --force \
 && /opt/computer-server/venv/bin/pip install --no-cache-dir \
      'cua-computer-server==0.3.46' 'fastmcp==3.2.4' 'PyJWT==2.14.0' \
 && /opt/computer-server/venv/bin/pip check

# Every bot of the account works on this computer as `box`, with passwordless sudo (ADR 035): there is no wall between
# bots here. Camoufox and botdot's bridge into it run as `browser`, whose home and bridge socket a program of the
# bots cannot open without sudo, and which may write into box's Downloads folder (#311). /workspace is shared by the
# bots. The container runs as `box` (lib/computers.js), so the desktop's services write their logs and pid as it.
# Each bot's Camoufox keeps its own profile in /home/browser/profiles/<bot> (#105).
RUN useradd --create-home --shell /bin/bash box \
 && useradd --create-home --shell /usr/sbin/nologin --groups box browser \
 && printf 'box ALL=(ALL:ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/botdot-box \
 && chmod 0440 /etc/sudoers.d/botdot-box \
 && visudo -cf /etc/sudoers.d/botdot-box \
 && chmod 0700 /home/browser \
 && install -d -o browser -g browser -m 0700 /home/browser/profiles \
 && install -d -o box -g box -m 2775 /home/box/Downloads /workspace \
 && install -d -o browser -g browser -m 0700 /run/botdot-browser \
 && install -d -o box -g box -m 0755 /run/botdot-desktop /var/log/supervisor \
 && install -d -m 1777 /tmp/.X11-unix /tmp/.ICE-unix

# Camoufox (anti-detect Firefox) via its Python launcher, in its own venv. The browser itself is fetched into
# CAMOUFOX_CACHE, root's like the launcher, so that not even the browser user can change what botdot types
# through (#311); the bridge gives the launcher that folder (lib/computers.js). The launcher writes its font
# settings into camoufox/fontconfig there on every start, so only that folder is the browser user's. Root in the
# computer had no right to chown when this was written (--cap-drop ALL, ADR 021), so the image makes it.
# Both pinned to what the released images carry, so a rebuilt layer installs the same pair.
# Launcher 0.5.7 needs indexed-zstd, which has no arm64 wheel and cannot be compiled here, as
# the C headers went with the kernel packages above; launcher 0.5.6 does not know the patches
# of browser 156 and skips them.
RUN python3 -m venv /opt/camoufox \
 && /opt/camoufox/bin/pip install --no-cache-dir 'camoufox[geoip]==0.5.6' \
 && XDG_CACHE_HOME=/opt/camoufox-cache /opt/camoufox/bin/python -m camoufox fetch official/152.0.4-beta.31 \
 && XDG_CACHE_HOME=/opt/camoufox-cache /opt/camoufox/bin/python -m camoufox set official/stable/152.0.4-beta.31 \
 # fetch and set exit 0 even when the GitHub sync fails, so fail here if no browser was installed.
 && XDG_CACHE_HOME=/opt/camoufox-cache /opt/camoufox/bin/python -c "from camoufox.multiversion import get_active_path; import sys; sys.exit(0 if get_active_path() else \"Camoufox was not installed\")" \
 && chmod -R a+rX,go-w /opt/camoufox-cache \
 && install -d -o browser -g browser -m 0700 /opt/camoufox-cache/camoufox/fontconfig

COPY camoufox-browser /usr/local/bin/camoufox-browser
COPY botdot-desktop /usr/local/bin/botdot-desktop
# Each bot's screen: one supervisord with this per bot, started by botdot on the bot's first computer tool (#105).
COPY botdot-screen.conf /etc/supervisor/botdot-screen.conf
COPY camoufox.desktop /usr/share/applications/camoufox.desktop
COPY camoufox-helper.desktop /usr/share/xfce4/helpers/camoufox.desktop
# The bots' installs into box's home without sudo, and a way onto the owner's tailnet in userspace (ADR 032).
COPY --from=micromamba --chmod=0755 /micromamba /usr/local/bin/micromamba
COPY botdot-install /usr/local/bin/botdot-install
COPY botdot-tailscale /usr/local/bin/botdot-tailscale

# Make it the default browser everywhere: XFCE's web-browser launcher, xdg-open and x-www-browser.
RUN chmod 755 /usr/local/bin/camoufox-browser /usr/local/bin/botdot-desktop /usr/local/bin/botdot-install /usr/local/bin/botdot-tailscale \
 && mkdir -p /etc/xdg/xfce4 && printf 'WebBrowser=camoufox\n' > /etc/xdg/xfce4/helpers.rc \
 && mkdir -p /home/box/.config/xfce4 && printf 'WebBrowser=camoufox\n' > /home/box/.config/xfce4/helpers.rc \
 && update-alternatives --install /usr/bin/x-www-browser x-www-browser /usr/local/bin/camoufox-browser 300 \
 && update-alternatives --set x-www-browser /usr/local/bin/camoufox-browser \
 && printf '[Default Applications]\ntext/html=camoufox.desktop\nx-scheme-handler/http=camoufox.desktop\nx-scheme-handler/https=camoufox.desktop\n' > /home/box/.config/mimeapps.list \
 && chown -R box:box /home/box/.config

LABEL botdot.desktop="camoufox" botdot.user-version="2"
