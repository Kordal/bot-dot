# botdot in one image, built on the official llama.cpp server image (which has llama-server in /app),
# with the bge-m3 model inside for meaning-based memory search. Works on linux/amd64 and linux/arm64.
#
#   docker compose up -d --build        (see compose.yaml)
#
# Bot computers run next to this image. Only the docker-helper service receives the host socket.

# Reviewed 2026-09-29: Node 24 bookworm, llama.cpp server, Docker CLI 29.7.2.
# Multi-platform index digests; changing a tag alone cannot change the build bases.
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
ARG LLAMA_IMAGE=ghcr.io/ggml-org/llama.cpp:server@sha256:f9115c95639e60abc09d4ea83b26fd4d56c66aa1174594393335a514da00c283
ARG DOCKER_CLI_IMAGE=docker:29.7.2-cli@sha256:3f4743208d2338c934d7b8bcfbe1bb54c0b2355c510ad5e0f31c0c4a54bd704e

FROM ${NODE_IMAGE} AS node
FROM ${DOCKER_CLI_IMAGE} AS dockercli

# micromamba 2.9.0, the installer of the bots' tools (docs/adr/007): one program per architecture, each
# pinned by the sha256 its release publishes next to it. Only the stage of the build's architecture is built
# (TARGETARCH is amd64 or arm64; BuildKit sets it).
FROM scratch AS micromamba-amd64
ADD --checksum=sha256:366cd9cd8be14df1ab8ed50352a82111082a36686b2d389fdb79a92c3fafb3e3 \
    https://github.com/mamba-org/micromamba-releases/releases/download/2.9.0-0/micromamba-linux-64 /micromamba
FROM scratch AS micromamba-arm64
ADD --checksum=sha256:9f93b974adcb4d166996af969b6cd371287d1a3e52733704727884d9b74cb7a7 \
    https://github.com/mamba-org/micromamba-releases/releases/download/2.9.0-0/micromamba-linux-aarch64 /micromamba
FROM micromamba-${TARGETARCH} AS micromamba

FROM ${LLAMA_IMAGE}

# Everyday tools bots use (git, python3, curl, ssh for script jobs, ADR 087), time zones, and tini to pass on signals and reap
# finished processes. Files bots make for the owner: WeasyPrint (HTML to PDF, with fonts for most
# languages), python-docx (Word) and openpyxl (Excel).
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates curl git openssh-client python3 tzdata tini \
      weasyprint python3-docx python3-openpyxl fonts-dejavu fonts-liberation2 \
 && rm -rf /var/lib/apt/lists/*

# Node (botdot itself, and the Claude Code and Bitwarden CLIs).
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node --version

# The Docker CLI, to start the bots' own computers on the host's Docker…
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
# …and Compose, so botdot can update itself (Settings → Updates).
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose

# Claude Code 2.1.309 (the bots' engine), Bitwarden CLI 2026.9.0 (the vault).
RUN npm install -g @anthropic-ai/claude-code@2.1.309 @bitwarden/cli@2026.9.0 \
 && npm cache clean --force \
 && claude --version && bw --version

# micromamba, for the tools user alone (UID 60400, lib/privilege-broker.js): the broker runs it to install a
# bot's tools; a bot and the Chief cannot run it.
COPY --from=micromamba --chown=60400:60400 --chmod=0550 /micromamba /usr/local/bin/micromamba
RUN micromamba --version

# The bge-m3 embedding model (about 635 MB, MIT licence), published by the llama.cpp project.
# Readable by every user: a file added from a link is its owner's alone (0600, root), and botdot's server, which
# starts llama-server with it, has not been root since it got its own user. Its folder is made first, so that
# the file's mode is not the folder's too.
RUN mkdir -p /opt/models
ADD --checksum=sha256:aa473d51f451a22f0fcf39ba3330c14bed38a385712b1113440f69df4047a173 --chmod=0644 \
    https://huggingface.co/ggml-org/bge-m3-Q8_0-GGUF/resolve/main/bge-m3-q8_0.gguf \
    /opt/models/bge-m3-q8_0.gguf

WORKDIR /opt/bot-dot
# What goes in is listed in .dockerignore (an allowlist): botdot's code, never data or secrets.
COPY . .

ENV NODE_ENV=production \
    BOT_DOT_DATA=/data \
    BOT_DOT_VAULT_KEY_FILE=/config/vault.key \
    EMBED_SERVER_BIN=/app/llama-server \
    EMBED_MODEL_FILE=/opt/models/bge-m3-q8_0.gguf \
    CLAUDE_BIN=/usr/local/bin/claude \
    MICROMAMBA_BIN=/usr/local/bin/micromamba \
    PORT=4747

# Keep /root as the persistent server home for upgrades from the former root server.
# The supervisor migrates application state before starting the server as UID/GID 60000.
# The home directory stays root-owned and sticky to protect legacy Docker credentials.
VOLUME ["/data", "/config", "/root"]
EXPOSE 4747

# The llama.cpp image checks llama-server on port 8080; check botdot instead.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/api/version" || exit 1

# The llama.cpp image starts llama-server by default; this image starts botdot, which starts
# llama-server itself when meaning-based search is on.
# The supervisor and Docker helper start root; only the supervisor drops the server identity.
USER 0:0
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "lib/privilege-broker.js"]
