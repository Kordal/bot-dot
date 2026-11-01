# ADR-131: A bot's commands end with its run and have limits, on both its shells

- **Status:** Accepted
- **Owning task:** [#830](https://github.com/Kordal/bot-dot/issues/830)

## Context

Four process trees of `tsc --noEmit` and `eslint` from one finished run stayed alive for about five hours, holding about 5 GB of an account's 9 GB. The account thrashed its page cache, the machine's load reached about 50 on 8 CPUs, and the account's bot-dot container turned unhealthy.

ADR 089 ends what botdot starts on the account's computer. A bot has a second shell: Claude Code's Bash in the bot-dot container. It runs each command in a process group of its own (verified on Claude Code 2.1), and the privilege broker signals only the group of `claude`, so a command there outlives its run and has no limit of its own. On the computer, a `run_shell` going when its run ended went on to its time limit, and a `botdot-run` killed outright by `timeout -k 5` left what it held.

Under gVisor there are no cgroups per command and no systemd inside a container, so `systemd-run --scope` and `memory.max` per command are not available. `RLIMIT_AS` is no substitute: Node.js and browsers reserve far more address space than they use.

## Decision

- **Every process the broker spawns runs under `botdot-run`,** sent with each spawn. It is the subreaper of the run, so what leaves its process group with `setsid` still comes to it, and it ends what is left when `claude` or a script job ends.
- **A principal with nothing live has every process of its uid ended,** with a line in the log for each, a few seconds after its last process ended and every two minutes. A uid holds nothing but a principal's work, and bots cannot change it (`no-new-privileges`), so this holds even when `botdot-run` was killed outright.
- **The end of a run ends its commands on the computer.** Each carries `--run <id>`, and `computers.endRun` sends SIGTERM to the `botdot-run` holding it. `start_program` carries none: its program belongs to the bot's screen, as ADR 089 decided, and ends with it at most 30 minutes after its last use.
- **`botdot-run` holds a command to its limits by reading `/proc`,** every two seconds: the resident memory of all it started added up, and the time. Over a limit it ends the tree and says why on stderr, which the bot reads; on the computer it exits with 137.
  - On the computer: `run_shell` keeps its 600 s, by `timeout`, and memory is `BOT_DOT_COMMAND_MEMORY_PERCENT` of the account's RAM, default 60. `start_program` has the same memory limit and no time limit.
  - In Claude Code (`--commands`): each shell child of `claude`, and each process that lost its parent, is one command, held to the same memory and to `BOT_DOT_BASH_MAX_SECONDS`, default 900. `claude` and its MCP servers are not commands and stay.
- **CPU has no limit per command.** The account's `CPUQuota` stays what holds an account back; gVisor ignores `nice`.
- **`timeout -k` gives `botdot-run` 15 seconds,** not 5, to end what it holds on a loaded computer.
- **What box and browser left with no `botdot-run` above it is ended** (`deploy/desktop/botdot-sweep`, every two minutes, as root), with a line in the log for each, once it is `BOT_DOT_ORPHAN_MINUTES` old, default 35: botdot's longest bounded call that runs without `botdot-run` takes 30. This replaces "What is left anyway is said, not ended" of ADR 089 for those two users.
- **What runs as root is still left alone and said,** as ADR 089 decided: a bot may have set up a service on purpose.

## Alternatives

- **A cgroup per command.** Not available under gVisor, as above.
- **A marker in each process's environment.** A uid already tells whose a process is in the bot-dot container, and a process can drop an environment variable.
- **Ending root's processes too.** It would end the computer's Tailscale and a service a bot set up.
- **Remaking every computer at once so that each has an init.** It loses what apt installed. A computer made before ADR 089 keeps `sleep` as PID 1 until its next Update; only that Update ends its zombies.

## Consequences

- A long build in Claude Code's Bash ends after 15 minutes; a bot uses its computer's `start_program` for what must run longer.
- A background server in Bash ends with its run.
- A `nohup` command that outlives a killed `botdot-run` on the computer lives up to 37 minutes before the sweep ends it.
- Each run in the bot-dot container has one more process, and every two seconds a walk of `/proc`.
