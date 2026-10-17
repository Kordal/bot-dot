# botdot desktop: cua's Ubuntu/XFCE computer with Camoufox as the web browser.
# Built automatically by botdot the first time a bot needs a computer.
# Reviewed 2026-09-29; the index contains both amd64 and arm64.
ARG BASE=public.ecr.aws/k5j5w0x5/cua-ubuntu-24.04:docker-latest@sha256:c67f330f287b0e5124f57c64bcf06a7e4b90208186c3036e1312b15d854f6d13
FROM ${BASE}
USER root

# The upstream VM-derived filesystem includes a guest kernel. Containers use the host
# kernel: remove its unused boot image, modules, tools and development headers, including
# libc6-dev (which depends on linux-libc-dev). Runtime libc and desktop libraries stay.
RUN dpkg-query -W -f='${binary:Package} ${db:Status-Status}\n' \
    | awk '$2 == "installed" && $1 ~ /^linux-(image|headers|modules|tools|virtual|libc-dev)/ { print $1 }' \
    | xargs -r apt-get purge -y \
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

# The bot works on its computer as `bot`, not root. Camoufox and botdot's bridge into it run as `browser`, whose
# home and bridge socket the bot cannot open, and which may write into the bot's Downloads folder (#311).
# The container runs as `bot` (lib/computers.js), so the desktop's services write their logs and pid as it.
RUN useradd --create-home --shell /bin/bash bot \
 && useradd --create-home --shell /usr/sbin/nologin --groups bot browser \
 && chmod 0700 /home/browser \
 && install -d -o bot -g bot -m 2775 /home/bot/Downloads \
 && install -d -o browser -g browser -m 0700 /run/botdot-browser \
 && install -d -o bot -g bot -m 0755 /run/botdot-desktop /var/log/supervisor \
 && install -d -m 1777 /tmp/.X11-unix /tmp/.ICE-unix

# Camoufox (anti-detect Firefox) via its Python launcher, in its own venv. The browser itself is fetched into
# CAMOUFOX_CACHE, root's like the launcher, so that not even the browser user can change what botdot types
# through (#311); the bridge gives the launcher that folder (lib/computers.js). The launcher writes its font
# settings into camoufox/fontconfig there on every start, so only that folder is the browser user's. Root in the
# computer has no right to chown (--cap-drop ALL), so the image makes it.
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
COPY supervisord.conf /etc/supervisor/supervisord.conf
COPY camoufox.desktop /usr/share/applications/camoufox.desktop
COPY camoufox-helper.desktop /usr/share/xfce4/helpers/camoufox.desktop

# Make it the default browser everywhere: XFCE's web-browser launcher, xdg-open and x-www-browser.
RUN chmod 755 /usr/local/bin/camoufox-browser /usr/local/bin/botdot-desktop \
 && mkdir -p /etc/xdg/xfce4 && printf 'WebBrowser=camoufox\n' > /etc/xdg/xfce4/helpers.rc \
 && mkdir -p /home/bot/.config/xfce4 && printf 'WebBrowser=camoufox\n' > /home/bot/.config/xfce4/helpers.rc \
 && update-alternatives --install /usr/bin/x-www-browser x-www-browser /usr/local/bin/camoufox-browser 300 \
 && update-alternatives --set x-www-browser /usr/local/bin/camoufox-browser \
 && printf '[Default Applications]\ntext/html=camoufox.desktop\nx-scheme-handler/http=camoufox.desktop\nx-scheme-handler/https=camoufox.desktop\n' > /home/bot/.config/mimeapps.list \
 && chown -R bot:bot /home/bot/.config

LABEL botdot.desktop="camoufox" botdot.user-version="1"
