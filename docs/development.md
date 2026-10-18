# Development

Running botdot from the source, the tests and the code layout.

## Running it

**For development:** no dependencies, just Node 22.13 or newer (for its built-in SQLite, used by the memory).

```bash
npm start            # → http://localhost:4747
```

## Setup notes

- **Claude CLI.** Found automatically: first `CLAUDE_BIN`, then `claude` on your PATH, then the copy inside the Claude desktop app. The CLI must be logged in. If a run says "Not logged in", run the CLI once in a terminal and type `/login`. It must also be new enough to take its prompt from a file (`--append-system-prompt-file`; the one in the Docker image is): with an older one botdot says so when it starts and in Setup, and runs no bot until Claude Code is updated and botdot restarted.
- **Port.** `PORT=5000 npm start`
- **Data.** Bots are stored in `data/bots.json` and run logs in `data/runs/`. Override the folder with `BOT_DOT_DATA`.
- **Security.** By default the server listens on 127.0.0.1 only. It rejects unknown Host headers and write requests that lack its custom header, so other websites can't trigger bots.

## Tests

`npm test` runs them, in about 2 minutes (two tests wait out a real one-minute schedule). Each test file starts real botdot servers on free ports with scratch data folders and their own vault keys, and a stand-in for Claude (`test/fixtures/fake-claude.js`), so they never touch your data or cost anything. When they are done, `npm test` checks that no stand-in Claude of this checkout was left running, and fails if one was (`test/run.js`). They cover bots and runs, bots messaging each other, the Chief's suggestions and answer buttons, the quiet phone, backups and restoring, memory, attached files, jobs, quiet scheduled runs, the bots' computers, the vault, who may use botdot, and the apps' updates (phone and Mac).

On GitHub, the **Tests** workflow runs them and builds the Android app, on every pull request and before the **Images** and **Android** workflows publish. When a test fails, nothing is published, and the VM and phones keep the last good version. Every workflow runs on GitHub's own throwaway machines, and `test/workflows.test.js` fails when one names any other runner. It also runs the separate-users test as root (`test/users.test.js`) and scans the history for secrets (gitleaks).

## Layout

```
server.js            HTTP API + static files + scheduler start
lib/bots.js          bot store, headless runner, scheduler
lib/chief.js         Chief of Staff chat (multi-turn, via --resume)
lib/mcp-server.js    MCP tools the Chief uses to manage bots
lib/computers.js     per-bot Docker desktops (start/stop/reset)
lib/computer-mcp.js  mouse/keyboard/screen/shell tools a bot uses on its desktop
lib/skills.js        skill library, GitHub import, per-run skill plugin
lib/settings.js      default model and reasoning level (Settings page)
lib/learning.js      the history of bots' main assignment, rules and skill changes (memory notes are in memory.js)
lib/memory.js        memory.db: notes and their history, the past-run index, reviews, meaning search
lib/prompt-text.js   text quoted into a prompt made inert (no note or chat message is markup), and the prompt's date line
chief-skills/        the Chief's own skills (e.g. memory-setup), loaded with --plugin-dir
lib/embed.js         meaning search: runs llama.cpp's llama-server with bge-m3, or uses EMBED_URL
install.sh           installs or updates botdot on Linux: the front door and each account
test/                the tests (npm test), with a stand-in Claude in test/fixtures
docs/api.md          the API for clients (the Android app): version, the live feed, bots, runs, the Chief, uploads
android/             the Android app (Kotlin, Jetpack Compose): see android/README.md
lib/events.js        the live feed (/api/events): runs, the Chief's replies, login requests, approvals
lib/updates.js       Settings → Updates: checks the registry, and updates botdot through a helper container
lib/registry.js      the private image registry: signing in with the read-only token, and which image a tag points to
lib/identity.js      separate users for the Chief and each bot (Docker installs), and who's on the other end of a connection
lib/uploads.js       files attached to messages, and readable copies of Office and OpenDocument files
lib/messages.js      bots messaging bots: the inbox and the limits
lib/backup.js        nightly encrypted backups, and restoring one
lib/choices.js       quick-answer buttons ([[choices: …]]) and the card of questions ([[ask: …]]) under a reply, and a bot's question in one line
lib/setup.js         the setup page's data: first-run state, time zone, Claude sign-in from the browser, and whether this Claude Code takes its prompt from a file
Dockerfile, compose.yaml   the all-in-one image (on the official llama.cpp server image) and how to run it
.github/workflows/images.yml   builds and publishes the images (Intel + ARM, private)
lib/self-mcp.js      a bot's tools for itself: its jobs, and learning (remember, create_skill…)
lib/jobs.js          scheduled jobs: AI or script, approval, running scripts
lib/connectors.js    Composio: API key, marketplace, connections, running actions
lib/connectors-mcp.js  the two connector tools bots get
lib/bitwarden.js     Bitwarden as the vault (bw CLI): unlock, bot-dot folder, cards, identities
deploy/desktop/      desktop image: cua Ubuntu + Camoufox
lib/cron.js          tiny 5-field cron parser
lib/dashboard.js     the Board: tiles, their values (a saved login, a script or their bot), taps, approvals
lib/vault.js         the built-in Vault: encrypted logins and their key
lib/vault-mcp.js     the login tools every bot gets (type_login, api_request, asking for a login)
lib/vault-http.js    api_request: calls made with a saved login, secrets filled in by botdot
lib/login-requests.js  the pop-ups for a missing login and for paying with a card
lib/asks.js          a permission, a skill or a tool a bot or the Chief asked for, waiting in Needs you
lib/tools.js         installed tools: the registry, the ask, tools.json, the install and the check at every start
lib/tools-link.js    a tool from a link: the download over https, what the file is, and the unpacking with its path checks
lib/tools-worker.js  the installer itself, run as the tools user: micromamba with a pinned list, or the one file behind a link
lib/problems.js      a failed run, said in plain words (web and phone)
public/              the UI (vanilla HTML/CSS/JS)
vendor/novnc/        botdot's own copy of noVNC, the live-screen viewer
macos/               the stopped Mac app (ADR 031): see macos/README.md
```
