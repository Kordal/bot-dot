# ADR-105: The admin page counts how accounts use botdot

- **Status:** Accepted (2026-10-27)
- **Owning task:** [#607](https://github.com/Kordal/bot-dot/issues/607)

## Context

The admin of a machine had no way to see whether its accounts' owners use botdot, which features they use or where their runs fail. ADR 028 kept the admin page outside every account: it shows each account's share of the machine and its load, measured from outside. The outcome ledger (ADR 099) now holds how each bot run went, in a form that can be counted without reading any run.

## Decision

- **Counts, asked for by the front door.** Each account's botdot server answers `GET /api/usage-summary?day=YYYY-MM-DD` to the front door alone (its socket and `x-botdot-room`, as `/api/room-bots`), for one finished UTC day: runs by outcome and error kind, counted, re-asked and corrected runs (the ledger), whether the owner used it, from the web page or the Android app, how many messages they sent, cards shown and answered and the median answer time (`lib/activity.js`), how many bots, which features it has set up now, and its version.
- **Nothing else.** No text of a message, a file or a card, no name of a bot, job or person, no email, no Vault value, no address, nothing from a computer, no cost or limit (AGENTS.md rule 5). The front door cuts every answer down to known counts, yes-or-no and a version before it keeps it. Every read on the account's side is of its own data folder: no privilege broker, no workspace.
- **Once a day, 13 months.** The front door checks every hour and asks each account for every finished day it lacks, up to 7 days back, one request at a time; a day an account didn't answer is asked for again. Rows live in `usage.json` beside `front-door.json` (mode 600). A row older than 13 months goes; a deleted account's rows go at once.
- **The admin page shows it.** Weekly active accounts, activation (a bot within its first two days, a good run within 7), week 1 and week 4 retention, runs, the correction rate, failures by kind and feature use over the accounts, and one row per account. Not on a machine of one account, which has no admin page.
- **Nothing leaves the machine.** No external tracker and no new dependency.

## Alternatives

- **A product analytics service (PostHog, Plausible, Umami).** Rejected: a heavy server or a script on the web page, against the no-dependency rule and the CSP, for questions the server can answer from what it already knows.
- **The front door reads the accounts' data itself.** Rejected: it never looks inside an account (ADR 028); the account decides what it hands out.
- **The account pushes its counts.** Rejected: the front door already asks accounts over their sockets (rooms, the group router), and asking lets it fill a day it missed.

## Consequences

- ADR 028's line moves: the admin page now shows counts handed out by each account, never what is inside it.
- Each owner request through the front door adds one counter in memory, written at most every 30 seconds.
- An opt-in ping for self-hosted machines and an in-app question are not part of this.
