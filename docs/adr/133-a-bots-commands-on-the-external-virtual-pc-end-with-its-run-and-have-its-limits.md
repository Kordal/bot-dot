# ADR-133: A bot's commands on the External Virtual PC end with its run and have its limits

- **Status:** Accepted
- **Owning task:** [#848](https://github.com/Kordal/bot-dot/issues/848)

## Context

ADR 131 ends a bot's commands with its run and holds each one to a memory and time limit through `botdot-run`, on the account's computer only. On the External Virtual PC (ADR 088, ADR 096) every bot of the account shares one machine, and botdot sent each command to boat.dev as it was: Stop left a `run_shell` and the Vault commands running to their time limit (up to 600 s), what they put in the background with `nohup` or `setsid` lived until the machine stopped, and one command could take all of the machine's memory from every other bot on it.

boat.dev runs a command through its API in a shell on the machine; there is no SSH and no signal of its own for a command in flight. The machine has Python 3, `timeout` and `pkill`, as the screen kit already relies on.

## Decision

- **Each of a bot's commands on the External Virtual PC runs under `botdot-run`,** botdot's own copy sent with the command as on the account's computer: `run_shell`, `run_with_login`, `run_with_ssh_key` and `run_with_file`, inside `timeout -k 15`, with `--run <id>` and `--memory`.
- **The memory limit is the machine's:** `BOT_DOT_COMMAND_MEMORY_PERCENT` (default 60) of the RAM of the machine's size. `start_program` runs under `botdot-run --keep` with the same limit and no run, as ADR 131 decided for the account's computer.
- **The end of a run ends its commands there,** as `computers.endRun` does on the account's computer: `pkill` of the `botdot-run` holding its id, sent only when botdot has that machine up. A stopped machine has nothing running and is never started for it.
- **The run's id goes in a shell variable** (`r=<id>; ... --run "$r"`), so the shell boat.dev runs around the command never matches the pattern itself: what a Vault command does after it (removing the secret, ending its ssh-agent) still runs.
- **`run_shell` keeps boat.dev's own shell** (`"${BASH:-sh}"`), so a command that worked before works the same.
- botdot's own fixed commands (file reads and writes, the screen kit, a copy of the bot's files) start nothing that stays, and run as before.

## Alternatives

- **Put `botdot-run` on the machine with the screen kit.** The kit installs in the background for minutes after a start, and a machine without it would run commands unheld meanwhile; a copy sent with each command needs nothing there, as on the account's computer.
- **A cgroup per command through `systemd-run`.** Not known to be there on boat.dev's machines, and the account's computer has none either; one mechanism for both keeps them alike.
- **Let boat.dev's own time limit end the command.** It does not end what the command left in the background, and gives nothing for Stop.

## Consequences

- Stop ends a bot's command on the External Virtual PC within seconds, with what it started in the background.
- A command over its memory limit there is stopped, exits 137 and says why on stderr, which the bot reads.
- `run_shell` there runs at most 570 s, as the Vault commands already did: boat.dev's own limit of 600 s must stay past `timeout`'s.
- Each command sent to boat.dev carries about 12 KB more, the copy of `botdot-run`.
