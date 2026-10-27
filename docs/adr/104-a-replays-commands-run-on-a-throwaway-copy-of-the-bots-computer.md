# ADR-104: A replay's commands run on a throwaway copy of the bot's computer

- **Status:** Accepted (2026-10-26)
- **Owning task:** [#595](https://github.com/Kordal/bot-dot/issues/595), part of [#592](https://github.com/Kordal/bot-dot/issues/592)
- **Amends:** [ADR 101](101-a-change-is-tried-on-a-bots-past-tasks-before-the-owner-sees-it.md)

## Context

ADR 101 replays a bot's past tasks with no commands and no computer, and ADR 102 gives them connected apps and saved logins that only read. For a bot whose work is on its computer (a disk check, a build, a script it keeps there), both replays then answer from memory, and the tally says little about the change. Running a replay's commands on the bot's own computer is ruled out: a replay must change nothing the owner has, and a command can change anything there.

## Decision

- **A copy per replay.** A replay of a bot with a computer gets `run_shell`, `read_file` and `write_file` (and nothing else of the computer: no screen, no saved login, no file for the owner) on a copy made for it alone, removed when it ends. The copy is never the bot's computer: the replay's tools reach botdot with a key that names the copy (`/api/replay/session`, `lib/routes/replay.js`), and no route leads from that key to the computer itself.
- **On this machine** the account's computer is committed to an image once per scoring (`docker commit --pause=false`, so its bots carry on), with what apt and the bots installed in it. Each replay gets a container from that image with the bot's folder copied in, and nothing else: none of the volumes, so not `/home/box`, not the other bots' folders, not the browsers' logins and not Tailscale. It has **no network** (`--network none`). The container goes with its replay, the image with its scoring. Only the Docker helper makes them, by fixed steps on ids botdot drew (`lib/docker-helper.js`).
- **On boat.dev** the External Virtual PC the bot works on is forked (`POST /sandboxes/:id/fork`): boat.dev copies its disk into a new machine and leaves it as it was. Before the first command botdot cuts the fork's network (new connections out are dropped, the loopback and what is already open stay) and checks that a connection out fails. A fork that can't be cut, or still reaches out, is deleted, and the replay has no computer. The fork is deleted with its disk when the replay ends; it is kept in `boat-replays.json` until boat.dev has it, so a botdot that stopped deletes it at its next replay. A machine that is off is forked off: it is not started for a replay.
- **No secret goes there.** The copy has no Vault tool, botdot hands it nothing, and nothing comes back from it: what a replay writes there ends with it.
- **When no copy can be made** (no computer yet, Docker or boat.dev failing), the replay runs without a computer, as before, and says so in its instructions.

## Alternatives

- **The bot's own computer, writes refused.** Rejected: a shell command can't be told safe before it runs.
- **One copy for the whole scoring.** Rejected: a replay would find what the one before it left, so the second side would start ahead.
- **A fresh container from the desktop image.** Rejected: it lacks what the bots installed, which is often what the task needs.
- **Leave the fork online.** Rejected: a command could still send, post or push from it with what is stored on the machine.

## Consequences

- A replay of a bot with a computer takes longer: a commit of the account's computer once per scoring, a container start per replay here, a fork and its start per replay on boat.dev. The pace (ADR 101) still bounds how many run.
- A task that needed the network on the computer fails alike on both sides of the replay, as a missing connected app does.
- A fork counts against boat.dev's limit of machines at once while it runs; at the limit the fork is refused and the replay has no computer.
- The image of a scoring takes disk while it runs, as much as the account's computer holds outside its volumes.
- Nothing about the copies is shown in an account (AGENTS.md rule 5): the boat.dev forks are the admin's, like the rest of boat.dev.
