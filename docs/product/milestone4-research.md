# Milestone 4 research: the Chief of Staff installs tools on the botdot server

Planning status: stage 6 closed on 2026-10-03; next: delivery, starting with TOOL-001.

Date: 2026-10-03. Revision inspected: `main` at `6ca1262` (Milestone 3 merged through pull request 161, the fix for leftover Claude processes through pull request 181, then two scaffold updates). The integration branch `milestone3` is contained in main, no task is claimed, and `docs/plans/planned/` and `active/` are empty. No product tests were rerun. This note is research evidence, not an implementation plan.

An earlier Milestone 4 ("a bot takes an issue to a pull request", git and `gh` through the Vault) was planned and cancelled by the owner on 2026-10-03 before any product code; its planning was reverted in `6cf956a`. This milestone reuses the number.

## Why this milestone

The owner asked for it on 2026-10-03 in these words: "the Chief of Staff should be able to install tools on the botdot server if bot or its functionality requires it."

The case behind it is in the cancelled milestone's research (`git show c269580:docs/product/milestone4-research.md`): the owner's Coder could not start on an issue because the GitHub command-line tool `gh` is not installed on the botdot server, and the task gate of bot-dot needs `make`, which is not installed either. That plan answered by adding `gh` to the image. The request now is the general form: a tool a bot needs gets onto the botdot server without a new botdot release.

## What the product delivers today

Verified by reading the code at the revision above:

- **Where a bot's commands run.** A bot is a Claude Code process in the botdot server's container, as its own Linux user (61000 to 61999), with `data/workspaces/<bot id>` as its folder and `data/homes/<bot id>` as its home (`lib/bots.js`, `lib/identity.js`, `lib/privilege-broker.js`). Its `Bash` tool runs there. A bot's computer is a separate container.
- **Tools in the image.** `git`, `curl`, `python3`, `weasyprint`, `python3-docx`, `python3-openpyxl`, Node with `npm` and `npx`, the Docker CLI, Claude Code and the Bitwarden CLI (`Dockerfile`). Not installed: `gh`, `make`, `jq`, `ffmpeg`, `pip`, `unzip`, a C compiler.
- **Nobody can install a system package.** The container drops all capabilities except six and sets `no-new-privileges` (`compose.yaml`, `compose.mac.yaml`). The server runs as user 60000. The only root process is the privilege broker, and it accepts five operations (`prepare`, `privateFile`, `files`, `fileStream`, `spawn`); `spawn` starts only Claude or `/bin/bash`, only as the Chief or a bot. Its own header says: "neither a root command nor an arbitrary chown is expressible". So `apt-get install` cannot run from the server, the Chief or a bot.
- **The Chief has no shell.** Its tools are botdot's own plus `Read`, `Grep`, `Glob` and `Skill` (`TOOL_ALLOW` in `lib/chief.js`); its instructions end with "You cannot change files yourself; delegate that to bots". None of its 40 botdot tools installs anything but a skill.
- **What a bot with "run commands" can already do.** It can write into its own home and workspace, so it can run `npx <package>`, download a binary with `curl` and run it from its workspace. Nothing asks the owner, nothing records it, and no other bot gets the tool. `npm install -g` fails (the global folder is root's). A bot's `PATH` is the server's; its own `~/.local/bin` is not on it.
- **What survives an update.** Updating botdot replaces the container with the new image (`lib/updates.js`, `lib/update-install.js`); only `/data`, `/config` and `/root` are volumes. Anything written into `/usr` is gone after an update. Homes and workspaces stay.
- **Backups.** A backup takes the data folder except a fixed list of top-level names (`SKIP_TOP` in `lib/backup.js`: models, the Bitwarden CLI, skill packs and others). A folder of installed tools in the data folder would be backed up unless added to that list.
- **Asking the owner exists.** Needs you holds five kinds of asks: a permission, a skill from a link, a changed bot, a connector action and a login (`lib/asks.js`, `server.js`). A skill from a link is the closest precedent: the Chief or a bot calls `ask_install_skill`, botdot reads the skill so the card can say what it is, and installs it on the owner's yes. All three apps already draw these cards.
- **The audit log has a fixed list of events** (`lib/audit.js`); none is about installed software.
- **A bot's computer is different.** It is the bot's own container, where it is root and can install what it likes; it keeps that across restarts (`lib/computers.js`). It does not hold the bot's workspace.
- **A botdot server without Docker** (the owner's Mac in development, `BOT_DOT_SEPARATE_USERS=0`): everything runs as the owner, and the tools are whatever the Mac has.

From the security analysis of 29 September 2026 (`docs/grok-sec-analysis.md`, not committed; read, not re-verified):

- F4, high: "One injected instruction can persist and spread across the team." A tool on every bot's `PATH` is such a place to persist.
- F3, high: the image ran as root with the Docker socket. Since then the server runs as user 60000 and only the helper container holds the socket (`compose.yaml`); a way to install as root would reopen part of that.

## Evidence boundaries

- The request is the owner's one sentence. Which tools, for which bots, and whether the owner wants to approve each install are not said; they are owner decisions at stages 2 and 3.
- The one concrete case (`gh` and `make` for the Coder) was reported by the bot and matches the `Dockerfile`; no container was started to check.
- The code findings were read, not exercised. That `npx` and a downloaded binary work for a bot today is an assumption from the file permissions, not a test.
- Which way of installing works without root, on both `linux/amd64` and `linux/arm64`, for the tools the owner needs, is not known. It is the main uncertainty and is assigned to stage 4.
- Other products' behaviour in "Existing solutions" comes from their documentation, not from use.

## Evidence and candidate improvements

| Evidence | Candidate improvement |
| --- | --- |
| The Coder could not work because `gh` was missing (reported by the bot); `make` is missing too (verified in the `Dockerfile`). | A tool gets onto the botdot server when a bot needs it, without a botdot release. |
| No process can install a system package (verified). | A place for tools that needs no root: a folder on the data volume that is on every bot's `PATH`. Or a narrow root operation in the broker. The architecture choice for stage 4. |
| The Chief has no shell and no install tool (verified). | A Chief tool that asks for a tool to be installed; botdot does the install, not the Chief's own commands. |
| A bot finds out a tool is missing in the middle of a run ("command not found"). | The bot can ask too, or tells the Chief; after the install the same command works in the same or the next run. A scope question for stage 3. |
| An update replaces everything outside the volumes (verified). | Installed tools live on the data volume, or botdot keeps a list and installs them again after an update. |
| Skills from a link wait in Needs you until the owner says Install (verified); the vision says "The owner approves what matters". | An install waits in Needs you with the tool's name, where it comes from and who asked. Whether every install needs the owner's yes is an owner decision at stage 2. |
| A bot can already fetch and run programs in its own folder, unasked and unrecorded (assumed from permissions). | Not closed by this milestone; an approved, recorded way makes the unrecorded one unnecessary. Limiting it is a separate question. |
| F4: an instruction can persist and spread (reported). | Only named tools from known sources; a record of every install in the audit log; the owner can see and remove what is installed, by asking the Chief. |
| The audit log has no event for installed software (verified). | Audit events for a tool installed and removed. |
| A backup takes the whole data folder but for a fixed list (verified). | Backups carry the list of tools, not the binaries; restore installs them again. A scope question for stage 3. |
| A botdot server without Docker uses the Mac's own tools (verified). | Out, or the same folder mechanism without separate users. A scope question for stage 3. |

## Carried forward

- Milestone 3: real use (A14) on the owner's own botdot server and the follow-up list of [milestone3-test.md](milestone3-test.md) are open and for the owner to decide.
- The cancelled Milestone 4: git and `gh` with a saved login. `gh` installed by this milestone would still have no login; that part stays cancelled unless the owner brings it back.
- Issue 9 (security findings before an open-source release) is open and blocked on the release scan; an install mechanism adds to what that scan must cover.
- Browser tests are still in no gate (the repository does not carry Playwright).
- No task is unfinished and nothing is blocked from outside.

## Proposed boundary for the discussion

In: the Chief of Staff getting a named command-line tool onto the botdot server for the bots, by chat; the owner's OK in Needs you; the tool working for bots' commands, surviving a restart and an update; listing and removing installed tools by chat; a record of each install. The server, the Chief's and the bots' instructions, and the card in Needs you on the web page, Android and the Mac.

Out: software on a bot's computer (the bot installs it there itself); skills and connectors (they have their own ways); logins for an installed tool (the cancelled milestone); a page or settings control listing tools; the Linux app.

## Existing solutions

Surveyed on 2026-10-03. Most pages were read through a fetch tool that summarises the page, so quoted wording may differ slightly; only the OpenClaw skills page and the Claude Code cloud page were checked against their raw text. Sizes and licences come from each project's latest release on GitHub.

### OpenClaw
https://docs.openclaw.ai/tools/skills, https://docs.openclaw.ai/install/docker-vm-runtime
Open-source, self-hosted agent gateway. The closest product.
- A skill declares the programs it needs (`requires.bins`) and how to get them (`install`: brew, node, go, uv, or a download with an optional `sha256`). A skill whose program is missing is left out when skills load.
- A download is unpacked into `~/.openclaw/tools/<skill>`: a folder of the user, no root.
- In Docker its answer is the opposite: "Installing binaries inside a running container is a trap: anything installed at runtime is lost when the container is recreated." Extra packages are named at image build time.
- Better than botdot today: the need is declared up front, so nothing fails in the middle of a run. Different: the person who runs it rebuilds the image; nobody approves a card.
- Unverified: whether its agent can start an installer without a person.

### Hermes Agent
https://hermes-agent.nousresearch.com/docs/user-guide/features/skills
- Skills with unmet requirements are hidden. There is no installer: "If a dependency is needed, document installation steps in the skill."
- Its Docker backend keeps one container, so what the agent installs stays until the container is replaced. It runs with all capabilities dropped and `no-new-privileges`, as botdot does.

### Devin
https://docs.devin.ai/onboard-devin/repo-setup
- The agent inspects the repository and proposes the tools it needs as "suggestion cards for approval"; the approved result is a declared list (a YAML blueprint) from which the machine is rebuilt.
- Better: the agent proposes, a person approves, and the result is a list, not a changed machine. The closest match to Needs you.

### Coding agents in the cloud
https://learn.chatgpt.com/docs/environments/cloud-environment (Codex), https://code.claude.com/docs/en/cloud-environments (Claude Code), https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment (Copilot), https://cursor.com/docs/cloud-agent/setup (Cursor), https://jules.google/docs/environment/ (Jules)
- One pattern in all five: a declared setup step runs as root with network before the agent starts, the disk is kept as a snapshot, and the snapshot is rebuilt when the declaration changes.
- Codex turns the internet off after setup and removes secrets before the agent starts. Claude Code and Copilot limit the network to a list of package registries.
- GitHub on agents installing by trial and error: it "can be slow and unreliable".
- Different: they have root and a throwaway machine per task. botdot has neither.

### Home Assistant add-ons and linuxserver.io
https://github.com/hassio-addons/addon-ssh/blob/main/ssh/DOCS.md, https://docs.linuxserver.io/general/container-customization/
- A list of packages in the configuration; "This installs the packages on every start". The stated cost is a longer start.
- Different: both need root and network at every start. botdot's container has no root that can install.

### Package managers that need no root
- **mise** (https://mise.jdx.dev/security.html): one program, MIT, about 30 MB. Tools from GitHub releases through the aqua registry, with a lock file of checksums, signature checks and a minimum release age. Has `gh` and `jq`; the aqua registry has no ffmpeg.
- **aqua** (https://aquaproj.github.io/docs/reference/security/): MIT, about 9 MB. Pinned versions and checksums; "Only standard registry is allowed by default"; runs no install scripts.
- **pixi** and **micromamba** (https://pixi.prefix.dev/latest/global_tools/introduction/): BSD-3, 18 to 34 MB. Packages from conda-forge into a folder of the user, one environment per tool, one manifest. conda-forge has `gh`, `make`, `jq` and ffmpeg for `linux-64` and `linux-aarch64`.
- **Homebrew on Linux** (https://docs.brew.sh/Homebrew-on-Linux): needs glibc 2.39, its default prefix or one of at most 26 bytes, and a C toolchain.
- **Nix, devbox, Flox** (https://nix.dev/manual/nix/latest/installation/): Nix creates `/nix` with `sudo`. nix-portable needs no root but falls back to a slow mode without user namespaces; last released in April 2024.
- **`uv tool`, `pipx`, `npm` with a prefix**: tools written in Python or Node, into a folder of the user.

### Security reports
- Snyk scanned 3,984 agent skills: 13.4% had a critical issue and 76 carried instructions to download and run something (https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub). OpenClaw added a virus scan and calls it "not a silver bullet" (https://www.openclaw.ai/blog/virustotal-partnership).
- Models invent package names: 5.2% of names from commercial models and 21.7% from open ones did not exist (https://arxiv.org/abs/2406.10279). An attacker can register such a name.
- The Shai-Hulud worm spread through npm's install scripts (https://github.blog/security/supply-chain-security/our-plan-for-a-more-secure-npm-supply-chain/).
- A report of 341 malicious OpenClaw skills was seen only in secondary coverage. Unverified.

## Ideas worth adopting

- The agent proposes, the owner approves a card, and what is kept is a list. Devin.
- The list is applied again after an update, so the image stays as shipped. Claude Code, Home Assistant, linuxserver.io.
- Each entry is a named tool with a pinned version and a checksum, from a curated registry, not a command the model wrote. OpenClaw's `download`, mise, aqua.
- No install scripts, and a minimum release age. pnpm, npm, mise.
- No secrets and only the registries reachable while installing. Codex, Claude Code, Copilot.
- A skill or a bot says which tools it needs, so a missing one is known before a run. OpenClaw, Hermes.
- Do not rely on a bot installing by trial and error in the middle of a run. GitHub.

## Solutions that make part of botdot unnecessary

None replaces the job, but the installing itself need not be written: pixi or micromamba (every tool named so far, both architectures, no root, a manifest to re-apply) or mise (stronger checks, fewer tools) can be the installer inside botdot.

Against that: no surveyed agent product installs into a data volume without root. They rebuild with root from a declared list, and OpenClaw calls installs at run time "a trap". botdot's reason to differ is that its owner does not build images and its container has no root to give. Whether one of these installers works in botdot's container as a bot's user is the question for stage 4.

## Uncertainties resolved at stage 4

Checked on 2026-10-03 with a throwaway trial: micromamba 2.9.0, pixi 0.81.0 and mise 2026.10.0 in the base image of the `Dockerfile` (Ubuntu 24.04), as user 60000 with the flags of `compose.yaml` (capabilities dropped, `no-new-privileges`), data on a Docker volume, on `linux/arm64` and, for micromamba, emulated `linux/amd64`. Nothing was written to the repository.

| Uncertainty | How it was checked | Result |
| --- | --- | --- |
| Does an installer work without root in botdot's container? | `gh`, `make`, `jq` and ffmpeg installed and run with each of the three. | Yes, all three; nothing failed because of the dropped capabilities. micromamba contacted `conda.anaconda.org` only. |
| Which one? | Size, coverage, exactness. | micromamba: 22 MB, all four tools on both architectures, installs from an explicit list with a sha256 per package. pixi: 66 MB, and its global installs keep no checksums. mise: 129 MB; verifies release attestations for `gh` and `jq`, and takes `make` and ffmpeg from conda as well. |
| Can an install be exact and repeatable? | An explicit list built from the installed packages, installed again; a wrong hash; offline from the cache. | Yes: the list installs with no solver and no index (`gh` in 0.5 s, 19 MB of memory); a wrong hash aborts and installs nothing. `env export --explicit` writes md5 only, so the list is built from the packages' own records. |
| What does finding the list cost? | The solver run for each tool. | 65 to 128 MB of memory, but 630 MB for `gh`: micromamba fell back to the whole index. Once per ask, not per install. |
| Can only that bot run a tool, and not change it? | The folder given to the bot's group, mode 0750, at the top only; tried as the bot, as another bot and as the server. | Yes on a Linux volume. It needs one root step. A recursive change breaks other bots through the hard links of micromamba's cache; `--always-copy` or changing only the top folder avoids it. Package files arrive group-writable. |
| Do packages run scripts during an install? | Looked for link scripts in the four tools. | One, in a dependency of ffmpeg. `--skip-run-link-scripts` turns it off and ffmpeg still works. |
| Must the path stay fixed? | A tool's folder moved and run. | Yes: `gh`, `make` and `jq` still ran, ffmpeg lost certificate checks and its font configuration. |
| How big is a tool? | `du` after install. | `gh` 43 MB, `make` 7 MB, `jq` 7 MB, ffmpeg 493 MB and 124 packages (650 MB on amd64). The registry's own size for ffmpeg, 13 MB, is the tool's archive alone. |
| What is the card's text built from? | `api.anaconda.org/package/conda-forge/<name>` and a dry run. | The summary and the latest version from the registry's record; the version and the download size from the resolved list. |
| Does it work when botdot is hosted on a Mac? | The same on a bind mount of the Mac's disk. | In part: installs from an explicit list work; the solver's cache breaks on its second run there, and the mount shows every file as owned by whoever looks, so "only that bot" could not be checked. Assigned to TOOL-001: keep the cache off the data folder, and check on a Mac-hosted botdot what another bot can reach. It does not block the queue. |
| Can an old app answer the new card? | Read `NeedsYouScreen.kt` and `Needs.swift`. | Yes, as a skill card with an empty name: an unknown kind of ask falls into the skill branch, and the answer goes to the server by the ask's id. |
| How does a bot reach the Chief with one OK? | Read `lib/self-mcp.js` and `lib/chief.js`. | `send_to_chief` waits for the owner's Approve in a new chat, which would be a second OK. A bot's request for a tool needs its own path that starts a Chief turn; TOOL-001 builds it on the way a bot's report reaches a Chief chat. |
| How are installs done as root-free as possible, but with a folder the bot cannot write? | Design. | [ADR 007](../adr/007-installed-tools-are-pinned-lists-placed-by-a-tools-user.md), Proposed, owned by TOOL-001. |

Not run: a tampered registry server, signature checks (experimental in micromamba), pixi and mise on amd64, host networking as on the Linux server. The trial is one afternoon on one machine: it shows the mechanism, not a year of updates.

One scope detail changed with these findings and is within the agreed scope: a clash of command names is known only after the install, so the Chief says it when it reports the install; the card cannot.

Nothing is blocked from outside.
