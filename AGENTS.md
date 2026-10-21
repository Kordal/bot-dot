# AGENTS.md

Canonical instructions for every agent working in this repository. Nested `AGENTS.md` files add directory-specific rules: read the one closest to the files you change; the more specific file wins where they conflict.

## Purpose

botdot gives each person a team of AI bots they run by chat: a Chief of Staff creates, changes and runs the bots, and the web page and the Android app are windows onto that person's account on a self-hosted botdot machine, which holds one or more accounts walled off from each other ([vision](docs/product/vision.md), [ADR 028](docs/adr/028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md)). The Mac app is stopped ([ADR 031](docs/adr/031-the-mac-app-is-stopped-again.md)).

## Product scope

[Milestone 1](docs/product/milestone1.md): every bot is shown as a head in its colour with a hat, not a dot, on the web page and in the Android app (and in the Mac app, stopped since ADR 031); its face shows its state, and Claude picks or draws the hat when the bot is created.

[Milestone 2](docs/product/milestone2.md): a bot with a new reply shows dots in the list and a "New" line in its chat, a working bot says what it is about to do, the Chief writes each new bot as one job with what it never does, and notifications follow unread state, on the web page and in the Android app (and in the Mac app, stopped since ADR 031).

[Milestone 3](docs/product/milestone3.md): the Chief of Staff writes first, at most three times a day and only when it has something tied to the owner (a follow-up, a tip, a fresh find, a joke), as a plain Chief message with 👍 and 👎 under it, on the web page and in the Android app (and in the Mac app, stopped since ADR 031).

[Milestone 4](docs/product/milestone4.md): the Chief of Staff gets a command-line tool installed on the botdot server for one bot, from a registry or a link, without root and only after the owner's OK on a card in Needs you, on the web page and in the Android app (and in the Mac app, stopped since ADR 031).

[Milestone 5](docs/product/milestone5.md): the quick wins of the interaction audit: a failed send keeps the message, the phone approves only what it shows, a failed Chief reply looks failed, a hand-off and a requested report always come back, and nine smaller fixes, on the web page and in the Android app.

[Milestone 6](docs/product/milestone6.md): an OK continues the work: after the owner's yes on a card a bot or the Chief carries on with what waited for it, and an action in a connected app waits for the answer inside its run, on the web page and in the Android app.

[Milestone 7](docs/product/milestone7.md): busy and stopped: the owner's message to a working bot or a replying Chief waits its turn and is shown as waiting, Stop ends what it started and the run says who ended it, a late result is a short turn of the Chief, and a failing job is said once and not at night, on the web page and in the Android app.

[Milestone 8](docs/product/milestone8.md): nothing approved unseen, no question lost: "Approve all" approves no script, Decline says that it removes, a bot's question shows as "Asks" in the list and is never a quiet run, a change to an approved job or tile waits beside it while the approved one keeps running, and a bot carries on after the owner's yes on its own proposal, on the web page and in the Android app.

[Milestone 9](docs/product/milestone9.md): memory the owner can trust: "forget" erases and its chats are read by no bot, every note says who said it and when and what the owner said is never unpinned, a passing state ends by itself, the prompt is off the command line and Claude Code's own memory is off, the right note arrives without a tool call, the Chief files a note with the bot it belongs to, and memory has no screen: it is managed by chat, on the web page and in the Android app.

[Milestone 10](docs/product/milestone10.md): a team in one chat: the owner puts two to six bots in a group, made from a bot's chat or by the Chief of Staff, writes once and every member reads it and answers or passes under its own name, the bots hand the work on by naming each other until it is done or twelve replies have passed, and one Stop ends them all, on the web page and in the Android app.

The Mac app is stopped again since 18 October 2026 ([ADR 031](docs/adr/031-the-mac-app-is-stopped-again.md)): `macos/` stays as it is, and no workflow builds or tests it. New work covers the web page and Android only.

Implement only the scope of the selected ticket; proposals outside that scope remain follow-up work.

## Stack

Node.js 22.13 or newer with no dependencies (the botdot server and the web page, plain HTML, CSS and JavaScript); Kotlin with Jetpack Compose (Android); Swift with SwiftUI (the stopped Mac app, ADR 031); Docker (hosting and the bots' computers); micromamba (in the image, to install the bots' tools from conda-forge, [ADR 007](docs/adr/007-installed-tools-are-pinned-lists-placed-by-a-tools-user.md)).

Introduce another technology only when the active task requires it, with an ADR.

## Architecture principle

One botdot server holds the truth, and each app is a native window onto its API.

- A feature is decided once on the server and drawn twice: the web page and Android get it together ([ADR 0001](docs/adr/0001-native-apps-per-platform.md), [ADR 031](docs/adr/031-the-mac-app-is-stopped-again.md)). The admin page is the one exception: it belongs to the front door and is drawn on the web only ([ADR 028](docs/adr/028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md)).
- What must look the same everywhere is data the server hands out, not code written once per app ([ADR 003](docs/adr/003-one-figure-definition-for-all-apps.md)).
- An app that is older or newer than its server keeps working: it ignores what it doesn't know and asks the server's `features` before using something new.

## Rules

1. **Architecture changes** require an ADR in `docs/adr/` (see [docs/adr/README.md](docs/adr/README.md)). Read the ADRs that cover the code you are about to change: they hold the reasons the code cannot show. A smaller choice a later reader would question (a library, a default, a rejected approach) gets one dated line in [docs/DECISIONS.md](docs/DECISIONS.md), in the change that made it.
2. **Tests** accompany every piece of functionality; a change is done when its tests pass. `make lint` and `make test` need nothing running: run both before calling a change done. `make help` lists the slower suites (the real tool install, the real install, the image cleanup, the Android build, tests and lint); run the ones that cover what you changed. A change to what an install runs (`install.sh`, `compose*.yaml`, the `Dockerfile`, the docker-helper, the updater, `.github/workflows/images.yml`) is done when `make install-real` passes.
3. **Stay on task.** Implement only the selected ticket. Unrelated follow-up work becomes a new issue in the tracker, not a part of the change.
4. **The API is the contract.** A change to what the server sends or accepts is written in `docs/api.md` in the same task, and announced in `features` when apps must check for it.
5. **Minimal UI.** No new control for something the Chief of Staff can do by chat; no costs, budgets or usage limits anywhere in an account. Only the admin page shows each account's share of the machine and its load ([ADR 028](docs/adr/028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md)).
6. **Nothing a bot or the Chief writes is trusted as markup.** Text and drawings from Claude are validated on the server and drawn by the apps' own code ([ADR 004](docs/adr/004-pieces-as-restricted-shape-lists.md)).
7. **Use the product's words.** `CONTEXT.md` defines them (bot, main assignment, Chief of Staff, Board) and names the words to avoid. They apply to UI text, documents, names in code and what you write to the owner.
8. **Say what's new.** A change a person would notice adds a note to `whats-new/` in the same pull request: a title and 2 to 4 plain points ([whats-new/README.md](whats-new/README.md)). The apps show it once after an update.

## Talking to the owner

- Lead with the answer, in plain words, and keep it short.
- Say what you verified and what you did not. A result you did not see is reported as not checked.
- If the owner's approach is wrong or a better one exists, say so and propose the alternative before doing what they asked.
- Be direct: state the problem as it is.
- If my request is ambiguous, ask one clarifying question before doing anything.

## How work enters

Work runs through the skills below. Route a request before acting on it:

| Situation | Skill | What it does |
| --- | --- | --- |
| An idea to build | `/grill-with-docs` | Sharpens it by interview and keeps what is decided in `CONTEXT.md` and the ADRs |
| It needs more than one session | `/to-spec`, then `/to-tickets` | Publishes the spec as a GitHub issue and splits it into tickets, each naming what blocks it |
| A ticket, or an idea small enough for one session | `/implement` | Builds it test-first (`/tdd`) and reviews the diff (`/code-review`) before committing |
| Something is broken | `/diagnosing-bugs` | Reproduces it with one failing command, then fixes it under a regression test |
| Issues nobody has sorted yet | `/triage` | Moves them through the triage labels until an agent or the owner can take them |
| An effort too large to see the end of | `/wayfinder` | Resolves its open decisions one at a time, then hands over to `/to-spec` |
| "What should we improve in the code?" | `/improve-codebase-architecture` | Findings and proposals, no code |
| Not sure which of these fits | `/ask-matt` | Names the skill or the path |

Keep the interview, the spec and the tickets in one session; start each `/implement` in a fresh one, from its ticket. Tickets `/to-tickets` wrote are ready as they are: `/triage` is for issues that arrive from outside.

## Agent workflow

- **One ticket, one branch.** Branch from `main`; never commit to `main`.
- **One pull request per ticket,** opened against `main`, with `Closes #N` for its ticket in the body (the word, not only the number, or the issue stays open). The owner merges it. A parent issue closes by itself when its last sub-issue does (`.github/workflows/close-parent.yml`).
- **The issue is the plan.** A ticket's scope, its acceptance criteria and what blocks it live in its GitHub issue, not in a file of this repository.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for Kordal/bot-dot (gh CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Repository map

| Path | Contents |
| --- | --- |
| `docs/product/` | Vision, milestone scope, the owner's test lists and, under `improvements/`, improvement reports |
| `docs/adr/` | Architecture Decision Records |
| `docs/DECISIONS.md` | One dated line per small, non-obvious choice that is not architecture |
| `docs/agents/` | What the skills read: the issue tracker (`issue-tracker.md`), the triage labels (`triage-labels.md`) and the domain documents (`domain.md`) |
| `docs/archive/` | Past working notes, kept for history: reviews, audits, acceptance and memory reports, research notes, feature test lists and the Milestone 1 screenshots (`evidence/`) |
| `docs/screenshots/` | The README's picture of the web page |
| `scripts/` | `dev.js`, what `npm start` runs (the server behind the front door, on this machine), `check-code.js` and `typecheck.sh` (`make lint`'s code and type checks, `tsconfig.json`), and the tests of the documentation link check |
| `tests/` | Cross-component checks |
| `server.js`, `lib/` | The botdot server: API, bots, jobs, memory, the Chief's MCP server; `server.js` starts it and tries the routes of `lib/routes/` (one module per feature) in order |
| `public/` | The web page |
| `android/` | The Android app |
| `macos/` | The stopped Mac app and its `BotDotKit` package (ADR 031) |
| `test/` | The server's and the web page's tests (`npm test`) |
| `deploy/`, `install.sh`, `compose*.yaml`, `Dockerfile` | Hosting, images and the installer |
| `chief-skills/` | Skills the Chief of Staff ships with |
| `.claude/skills/` | The agent skills named in [How work enters](#how-work-enters), copied unchanged from their source ([README](.claude/skills/README.md)) |
| `CONTEXT.md` | The product's vocabulary |
