# ADR-098: The account's computer is in one place for all its bots

- **Status:** Accepted (2026-10-26, the owner's decision)
- **Owning task:** [#579](https://github.com/Kordal/bot-dot/issues/579)
- **Amends:** [ADR 088](088-a-bots-computer-may-be-a-machine-of-its-own-on-boat-dev.md), [ADR 096](096-the-accounts-boat-bots-share-one-machine-there.md), [ADR 091](091-a-bots-files-are-copied-when-its-computer-moves.md)

## Context

ADR 088 let each bot choose its computer: none, the account's computer on this machine, or boat.dev. ADR 096 put the account's boat.dev bots on one shared machine and kept a machine of its own for a bot that asked for one. The owner wants one choice for the whole account instead, made once, and no prices in the apps.

## Decision

- **One place for the account's computer:** this machine (`linux`) or the account's machine on boat.dev (`boat`), kept in the account's settings as `computerPlace`. The owner chooses it in Settings; the Chief does not.
- **A bot only says whether it has a computer.** Any computer it is given is the account's, where the account has it. The apps show one switch per bot.
- **A switch moves every bot with a computer** there, and asks once "Copy files" or "Start empty"; the copies are ADR 091's, one per bot. A switch waits while a copy runs.
- **No machine of its own on boat.dev.** `boatOwnMachine` is gone. A bot that still has one is copied to the account's machine by ADR 096's one-minute migration, and its machine goes only after that copy succeeded.
- **Upgrade without loss.** Before the owner chose, the place is boat.dev when it has a key and a bot works there, else this machine. Within a minute, botdot moves every bot whose computer is elsewhere there, with its files. Nothing moves while boat.dev has no key.
- **Words:** the apps call the machine on boat.dev the "External Virtual PC" and show no price for it or its sizes (AGENTS.md rule 5).

## Alternatives

- **Keep the choice per bot.** Rejected by the owner: one choice is simpler, and per-bot places split one team over two computers.
- **On upgrade, move everyone to this machine.** Rejected: bots set up on boat.dev would lose what is installed there, while the account's machine on boat.dev runs for them already.

## Consequences

- A bot can no longer be kept apart on a machine of its own; every bot with a computer shares the account's, as on this machine (ADR 035).
- On an account that had bots in both places, the bots on this machine move to boat.dev on upgrade, with their files; their installed programs, Tailscale and browser logins stay behind.
