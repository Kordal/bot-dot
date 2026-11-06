# External tools and versions

Every outside tool, image, package and CI action botdot ships or relies on, where its version is set, and how far it is from upstream. Checked on 6 November 2026 against npm, PyPI, crates.io, Maven Central, Docker Hub, conda-forge, developer.android.com and the GitHub release pages. Line numbers are as of commit `281cb04`; update this file in the same pull request as a bump.

Status: **ok** = newest stable, **behind** = a newer stable exists, **held** = behind on purpose (reason given), **unpinned** = whatever upstream serves on the day of the build or install.

## Needs attention

### Unpinned

| Tool | Where | What it takes | Risk |
| --- | --- | --- | --- |
| Tailscale on the server | `install.sh` (`Installing Tailscale`) | `curl https://tailscale.com/install.sh \| sh`, then Tailscale's signed apt repository | Kept on purpose: the machine's way in from the tailnet, so its security fixes should arrive with `apt upgrade`, as Docker's do. Upstream newest 1.104.5. |
| Tailscale in the computer | `deploy/desktop/botdot-tailscale:26`, `:67` | `pkgs.tailscale.com/stable` newest tarball, checked against its published sha256 | Kept on purpose: integrity checked, and a computer gets the day's security fixes when it first joins the tailnet. Userspace and shields-up. |
| Rootless Docker, uidmap, slirp4netns, acl | `install.sh:1585`-`1589` | The distribution's apt packages | Normal for host packages. |
| Debian/Ubuntu packages in the images | `Dockerfile:34`, `deploy/desktop/Dockerfile:39`, `:65`, `deploy/desktop/botdot-boat-kit:35` | apt, no versions | Rebuild changes them; the Trivy gate in `images.yml` catches critical CVEs. |
| Rust crates (ranges) | `desktop/src-tauri/Cargo.toml` | Semver ranges (`"2"`, `"0.22"`) | Held exactly by the committed `Cargo.lock`, so builds are reproducible. Fine as is. |
| Lima VM image | `desktop/src-tauri/src/local/lima.rs:117` | `template:ubuntu-24.04`, the cloud image of the day | The local Mac server's OS. |
| WSL distribution | `desktop/src-tauri/src/local/wsl.rs:11` | `Ubuntu-24.04` from the Microsoft Store | The local Windows server's OS. |
| GitHub runners | all workflows | `ubuntu-latest`, `macos-latest`, `windows-latest`, `ubuntu-24.04-arm` | Kept on purpose: GitHub announces a `-latest` move weeks ahead and rolls it out gradually, while a pinned image is retired on a date and then fails every job. |
| bge-m3 model | `Dockerfile:66` | Hugging Face `resolve/main` | Pinned by sha256, so a changed file fails the build instead of slipping in. |

### Risky or far behind

| Tool | Pinned | Newest | Why it matters |
| --- | --- | --- | --- |
| Camoufox launcher | 0.5.6 | 0.5.9 | **Being upgraded to 0.5.9 in another thread.** 0.5.7 needed `indexed-zstd`, which has no arm64 wheel. |
| Camoufox browser | `official/152.0.4-beta.31` | `v158.0.1-beta.41` (GitHub "Latest") | Six Firefox majors behind; fingerprint freshness drops with age. Goes with the launcher bump. |
| FastMCP | 3.2.4 | 4.1.6 | A major behind in the computer's control server. Held by cua-computer-server's needs; check before bumping. |
| FastAPI | 0.144.0 | 0.162.0 | **Held**: 0.145 refuses cua's `websocket_max_size` and the server dies at start (#601). |
| Node 24 (server image) | 24 by digest | 24.22.2; LTS is 26.13.0 | The server image's digest is older than the current `24-bookworm-slim`. Node 24 is maintenance LTS now; plan the move to 26. |
| Caddy | 2.10.2 | 2.11.9 | The front door's TLS edge on the internet. |
| Claude Code | 2.1.316 | 2.1.318 | Each bump needs real `claude -p` runs with the bot flags (sleep/Monitor behaviour changed at 2.1.310). |

## Server image (`Dockerfile`)

| Tool | Pinned | Where | Newest | Status |
| --- | --- | --- | --- | --- |
| Node.js base image | `node:24-bookworm-slim@sha256:0e0ff4…` | `Dockerfile:10` | 24.22.2 | behind |
| llama.cpp server image | `ghcr.io/ggml-org/llama.cpp:server@sha256:f9115c…` | `Dockerfile:11` | `:server` now `sha256:c0a110…` | behind |
| Docker CLI and Compose | `docker:29.7.2-cli` by digest | `Dockerfile:12` | 29.9.3 | behind |
| micromamba | 2.9.0, sha256 per arch | `Dockerfile:17`-`25` | 2.9.0-0 on GitHub (2.10.0 on conda-forge) | ok |
| Claude Code | `@anthropic-ai/claude-code@2.1.316` | `Dockerfile:52` | 2.1.318 | behind |
| Bitwarden CLI | `@bitwarden/cli@2026.9.0` | `Dockerfile:52` | 2026.10.1 | behind |
| bge-m3 embedding model | sha256 `aa473d…` | `Dockerfile:66` | n/a | ok |
| apt: ca-certificates, curl, git, openssh-client, python3, tzdata, tini | unpinned | `Dockerfile:34` | n/a | unpinned |

## Computer image (`deploy/desktop/Dockerfile`) and boat.dev kit (`deploy/desktop/botdot-boat-kit`)

The kit installs the same pins on an External Virtual PC; `test/boat-screen.test.js` fails when the two differ.

| Tool | Pinned | Where | Newest | Status |
| --- | --- | --- | --- | --- |
| cua base image | `cua-ubuntu-24.04:docker-latest` by digest | `deploy/desktop/Dockerfile:4` | not checked (tag is `docker-latest`) | pinned by digest |
| micromamba | 2.9.0 | `deploy/desktop/Dockerfile:5`-`13` | 2.9.0-0 | ok |
| npm | 10.9.9 | `deploy/desktop/Dockerfile:51` | 12.2.2 (10.x line kept for the base's Node) | ok on its line |
| proxy-addr (in supergateway) | 2.0.8 | `deploy/desktop/Dockerfile:52` | 2.0.8 | ok |
| pip (computer-server venv) | 26.2.2 | `deploy/desktop/Dockerfile:55`, kit `:65` | 26.3 | behind |
| cua-computer-server | 0.3.46 | `deploy/desktop/Dockerfile:57`, kit `:67` | 0.3.46 | ok |
| FastAPI | 0.144.0 | same line | 0.162.0 | held (#601) |
| FastMCP | 3.2.4 | same line | 4.1.6 | behind (major) |
| PyJWT | 2.14.0 | same line | 2.15.1 | behind |
| Authlib | 1.9.1 | same line | 1.9.5 | behind |
| Pillow | 13.0.0 | same line | 13.0.0 | ok |
| certifi | 2026.10.19 | same line, and `:105`, kit `:74` | 2026.10.23 | behind |
| websockify | 0.13.0 | kit `:69` | 0.13.0 | ok |
| Chrome headless shell | 152.0.7977.30, sha256 | `deploy/desktop/Dockerfile:68` | not checked (endpoint blocked); version Hyperframes 0.9 asks for | held |
| Camoufox launcher | `camoufox[geoip]==0.5.6` | `deploy/desktop/Dockerfile:105`, kit `:74` | 0.5.9 | **upgrading to 0.5.9 (other thread)** |
| Camoufox browser | `official/152.0.4-beta.31` | `deploy/desktop/Dockerfile:106`-`107`, kit `:75`-`76` | v158.0.1-beta.41 | behind |
| Tailscale | newest stable at run time | `deploy/desktop/botdot-tailscale:26` | 1.104.5 | unpinned on purpose |
| x11vnc, python3-venv, gcc and others (kit) | unpinned | kit `:35` | n/a | unpinned |

## Installer and hosting (`install.sh`, compose files)

| Tool | Pinned | Where | Newest | Status |
| --- | --- | --- | --- | --- |
| restic | 0.19.1, sha256 per arch | `install.sh:525` | 0.19.1 | ok |
| gVisor `runsc` | 20261102.0 (`GVISOR_RELEASE`; apt source names the release) | `install.sh` | 20261102.0 (apt `release` channel; GitHub "Latest" says 20261019.0) | ok |
| Tailscale | install script, then apt | `install.sh` | 1.104.5 | unpinned on purpose |
| Rootless Docker extras, uidmap, slirp4netns, acl | apt | `install.sh:1585`-`1589` | n/a | unpinned |
| Caddy | `caddy:2.10.2` by digest | `compose.front-door.yaml:62` | 2.11.9 | behind |
| botdot images | `ghcr.io/kordal/bot-dot:latest`, signed | `compose.yaml:11`, `compose.front-door.yaml:16` | own build | ok (checked by signature) |

## Web page (vendored, `vendor/`)

| Tool | Pinned | Where | Newest | Status |
| --- | --- | --- | --- | --- |
| Mermaid | 12.2.0 | `vendor/mermaid/package.json` | 12.3.0 | behind |
| noVNC | 1.5.0 | `vendor/novnc/package.json` | 1.7.0 | behind |
| qrcode-generator | 1.4.4 | `vendor/qrcode-generator/package.json` | 2.0.4 | behind (major; the copy is unchanged and works) |
| Node.js (server runtime floor) | `>=22.13` | `package.json` engines | 22.23.4 / 24.22.2 / 26.13.0 LTS | ok |

The server itself has no npm dependencies.

## Bot skill template (`bot-skills/skills/pages/site-kit/templates/svelte/package.json`)

| Tool | Pinned | Newest | Status |
| --- | --- | --- | --- |
| svelte | 5.57.2 | 5.57.3 | behind |
| vite | 8.3.5 | 8.3.6 | behind |
| @sveltejs/vite-plugin-svelte | 7.3.1 | 7.3.1 | ok |

## Android (`android/gradle/libs.versions.toml` unless noted)

| Tool | Pinned | Where | Newest | Status |
| --- | --- | --- | --- | --- |
| Gradle wrapper | 9.8.0 | `android/gradle/wrapper/gradle-wrapper.properties:3` | 9.8.2 | behind (patch) |
| Android Gradle plugin | 9.4.1 | `:2` | 9.5.0 | behind |
| Kotlin | 2.4.20 | `:3` | 2.4.21 | behind (patch) |
| Compose BOM | 2026.09.00 | `:4` | 2026.09.00 | ok |
| androidx.activity | 1.13.0 | `:5` | 1.13.0 | ok |
| androidx.lifecycle | 2.11.0 | `:6` | 2.11.0 | ok |
| androidx.navigation | 2.10.2 | `:7` | 2.10.2 | ok |
| androidx.datastore | 1.2.1 | `:8` | 1.3.0 | behind |
| androidx.core | 1.19.1 | `:9` | not checked | |
| OkHttp | 5.5.0 | `:10` | 5.5.1 | behind (patch) |
| kotlinx.serialization | 1.11.0 | `:11` | 1.12.0 | behind |
| kotlinx.coroutines | 1.11.0 | `:12` | 1.11.0 | ok |
| Reorderable | 3.1.0 | `:13` | 3.1.0 | ok |
| Coil 3 | 3.6.3 | `:14` | 3.6.3 | ok |
| androidx.browser | 1.8.0 | `:15` | 1.10.0 | behind |
| androidx.profileinstaller | 1.4.1 | `:16` | 1.4.1 | ok |
| androidx.benchmark / baselineprofile | 1.5.0 | `:18` | 1.5.0 | ok |
| JUnit 4 | 4.13.2 | `:17` | 4.13.2 | ok |
| androidx.test.ext:junit | 1.3.0 | `:19` | not checked | |
| androidx.test:runner | 1.7.0 | `:20` | not checked | |
| UiAutomator | 2.4.0 | `:21` | 2.4.1 | behind (patch) |
| Robolectric | 4.16.1 | `:22` | 4.17 | behind |
| SDK levels | compile 37, target 36, min 26 | `android/app/build.gradle.kts:41`-`46` | n/a | ok |
| Java | 17 bytecode, JDK 21 in CI | `android/app/build.gradle.kts:129`, `.github/workflows/android.yml:76` | n/a | ok |
| Emulator API in CI | 35 | `.github/workflows/tests.yml:200` | n/a | ok |

## Desktop and iOS (Tauri 2, `desktop/`)

Versions from `desktop/src-tauri/Cargo.lock`; `Cargo.toml` holds semver ranges.

| Tool | Locked | Newest | Status |
| --- | --- | --- | --- |
| tauri | 2.12.5 | 2.12.5 | ok |
| tauri-build | 2.7.4 | 2.7.4 | ok |
| tauri-plugin-updater | 2.14.1 | 2.14.1 | ok |
| tauri-plugin-deep-link | 2.6.3 | 2.6.3 | ok |
| tauri-plugin-dialog | 2.8.4 | 2.8.4 | ok |
| tauri-plugin-opener | 2.7.2 | 2.7.2 | ok |
| tauri-plugin-autostart | 2.7.0 | 2.7.0 | ok |
| tauri-plugin-single-instance | 2.5.5 | 2.5.5 | ok |
| tauri-plugin-window-state | 2.5.0 | 2.5.0 | ok |
| ureq | 3.5.0 | 3.5.1 | behind (patch) |
| windows | 0.62.2 | 0.62.2 | ok |
| objc2 | 0.6.5 | 0.6.5 | ok |
| serde_json | 1.0.154 | 1.0.154 | ok |
| sha2 | 0.10.9 (`"0.10"`) | 0.11.1 | behind (minor, breaking) |
| base64 | 0.22.1 (`"0.22"`) | 0.23.1 | behind (minor, breaking) |
| getrandom | 0.3.4 (`"0.3"`) | 0.4.3 | behind (minor, breaking) |
| sys-locale | 0.3.2 | 0.3.2 | ok |
| Tauri CLI | `@tauri-apps/cli@2.12.4` (`.github/workflows/desktop.yml:30`, `ios.yml:20`, `desktop-release.yml:103`) | 2.12.4 | ok |
| Lima (local Mac server) | 2.2.1 (`desktop/lima.sh:6`) | 2.2.1 | ok |
| Rust toolchain | 1.99.1 (`desktop/src-tauri/rust-toolchain.toml`, CI and local builds) | 1.99.1 | ok |

## CI (`.github/workflows/`)

All actions are pinned by commit SHA with the tag in a comment.

| Action | Pinned | Newest | Status |
| --- | --- | --- | --- |
| actions/checkout | v7.0.1 (`3d3c42…`) | v7.0.1 | ok |
| actions/cache | v5.1.0 (`caa296…`) | v6.1.0 | behind (v6 release notes not checked) |
| actions/setup-node | v7.1.0 (`949feb…`) | v7.1.0 | ok |
| actions/setup-java | v6.2.0 (`77dd5b…`) | v6.2.0 | ok |
| actions/upload-artifact | v7.0.2 (`cf430e…`) | v7.0.2 | ok |
| actions/download-artifact | v8.0.2 (`900082…`) | v8.0.2 | ok |
| docker/build-push-action | v7.4.0 (`c3c9e2…`) | v7.4.0 | ok |
| docker/login-action | v4.8.0 (`8aa583…`) | v4.8.0 | ok |
| docker/metadata-action | v6.2.0 (`dc8028…`) | v6.2.0 | ok |
| docker/setup-buildx-action | v4.4.1 (`f87e59…`), buildx v0.38.1 (`images.yml:84`, `:145`, `:331`) | v4.4.1, buildx 0.38.1 | ok |
| gradle/actions/setup-gradle | v5.0.2 (`072319…`) | v6.4.1 | held: v6 moved its caching into a closed-source component with its own terms of use |
| reactivecircus/android-emulator-runner | v2.38.0 (`a421e4…`) | v2.38.0 | ok |
| Trivy scanner | `aquasec/trivy@sha256:8f6bb9…` = 0.76.2 (`images.yml:233`, `deploy/test-critical-scan.sh`, `deploy/test-layer-secret-scan.sh`) | 0.76.2 | ok |
| Node in CI | 24 (`setup-node`), `node:24-bookworm-slim` = 24.22.2 by digest (`tests.yml:115`) | 24.22.2 | ok |
| skopeo | runner's apt (`images.yml:168`) | n/a | unpinned |

## Not tracked here

Models (`claude-*` ids in `lib/`) and outside services (boat.dev, Composio, Jev, Hetzner Storage Box) are chosen in the code and settings, not installed, so they have no version to pin. Tools the Chief installs for a bot come from conda-forge with a pinned list per bot (`lib/tools.js`, ADR 007) and are recorded in each account's `tools.json`.
