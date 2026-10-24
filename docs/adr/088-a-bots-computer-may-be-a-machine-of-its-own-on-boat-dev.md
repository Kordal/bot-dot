# ADR-088: A bot's computer may be a machine of its own on boat.dev

- **Status:** Accepted (2026-10-24)
- **Owning task:** [#529](https://github.com/Kordal/bot-dot/issues/529)
- **Amends:** [ADR 035](035-the-account-has-one-computer-all-its-bots-work-on-with-sudo.md)

## Context

Every bot with a computer works on the account's one computer (ADR 035): a container on the botdot machine, shared with sudo, with the account's share of memory and CPUs. A coding bot needs more: room for builds, real Docker, and a machine no other bot can see. hq has no KVM, so botdot cannot make virtual machines itself. boat.dev rents Linux machines by the hour (4 vCPU and 8 GB for about $0.036 an hour), keeps a stopped machine's disk 14 days, and has an API to make, start, stop and run commands in one.

## Decision

- **Per bot, the owner chooses where its computer is:** this machine (the account's computer, the default and free) or boat.dev (`computer: "boat"`). The choice shows only once the admin set a boat.dev key, as one "Computer" choice in a bot's settings (None, "This machine · free", "boat.dev · costs") in place of the "Uses the computer" switch (#541).
- **Only the computer moves.** Claude Code still runs on the botdot server with the owner's Claude sign-in; botdot reaches the bot's boat.dev machine through boat.dev's API (`lib/boat.js`) instead of `docker exec`. No SSH key and no Claude token go there.
- **Commands and files only.** A boat bot's tools are `run_shell`, `read_file`, `write_file` and the interactive page tools; it has no screen, no browser, and botdot puts no Vault secret there (`run_with_login`, `run_with_ssh_key`, `run_with_file`, `place_secret_file` and typing a login are refused). Its prompt says so.
- **One machine per bot**, made on its first computer tool and started again on the next one after it stopped. It stops after 30 minutes unused; boat.dev's own auto-stop (2 hours, pushed back on use) is the net under a botdot that stopped.
- **The admin's key**, set on the admin page, checked with one call (`GET /me`) before it is kept, never answered, and handed to each account by the front door every minute while one is set, as the group router's key (ADR 082).
- **When boat.dev can't start the machine** (no key, refused, unreachable), the bot's commands and files run on the account's computer for the rest of that run, and each answer says so: a bot keeps working, and nobody is misled about where. Its Vault calls stay refused there too.
- **The owner chooses the size** of the account's boat.dev machines in Settings (#539), boat.dev's `default` (4 vCPU, 8 GB) until then; each size shows its price per hour. A bot's machine takes a new size when it starts next (boat.dev resizes on resume, keeping the disk).
- **The Chief's change of a bot's computer waits for the owner's OK**: to boat.dev, which costs, and from one computer to the other, as a new computer does. Taking a computer away does not wait, nor does the owner's own switch.

## Alternatives

- **The whole run on boat.dev** (Claude Code in the machine, its tools tunnelled back). Rejected: the owner's Claude token would sit at a third party, and the work is far larger.
- **SSH into the machine.** Rejected for now: boat.dev registers a key per machine, again after every start, and its command and file API does the same with the admin's key alone.
- **Falling back to the account's computer silently.** Rejected: the bot's files would seem to vanish.

## Consequences

- The repository and whatever a boat bot puts on its machine are at boat.dev (EU), and that bot has no computer of its own while boat.dev is down.
- A boat bot is isolated from the other bots: it shares no sudo with them, unlike the account's computer.
- Costs are boat.dev's and the admin's: botdot keeps no budget or limit (AGENTS.md rule 5).
- Snapshots and a machine per task (forks) are a later slice.
