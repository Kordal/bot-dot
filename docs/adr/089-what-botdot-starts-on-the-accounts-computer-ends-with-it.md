# ADR-089: What botdot starts on the account's computer ends with it

- **Status:** Accepted
- **Owning task:** [#535](https://github.com/Kordal/bot-dot/issues/535)

## Context

After five days of uptime the account's computer held 1189 processes on no bot's screen, using about six CPUs, and a bot's Camoufox hung; only a restart cleared it. The computer started with `sleep infinity` as PID 1, which never reaps: every process whose parent died and that then ended stayed a zombie. The end of a screen ([#105](https://github.com/Kordal/bot-dot/issues/105), its rest after 30 minutes unused, [#126](https://github.com/Kordal/bot-dot/issues/126)) killed its supervisord, bridge, browser and X server by name, and left what those had started and every program of `start_program`. A command of `run_shell` ended only when it ran out of time, and what it had put in the background, with `setsid` or `nohup` too, went on.

A computer is kept with what was installed on it ([#107](https://github.com/Kordal/bot-dot/issues/107)): its PID 1 can change only when it is made again, by an Update, which loses what apt installed.

## Decision

- **A new computer has Docker's init as PID 1** (`docker run --init`), which reaps every orphan. A Docker without one makes it without, as one that refuses the share's limits does.
- **Every command, screen, bridge and program botdot starts runs under `botdot-run`** (`deploy/desktop/botdot-run`), sent by botdot with each call as `botdot-usage` is, so it needs no file in the computer and works on a computer made before this. It is the subreaper of all it starts: a process that leaves its parent, with `setsid` too, comes to it and is reaped when it ends. When its command ends, or a signal reaches it (the time limit, a screen's end), it ends what is left: SIGTERM, then SIGKILL two seconds later. It ends only what runs as its own user: what a command started as root through sudo is the computer's own (its Tailscale, a service a bot set up) and goes on.
- **A bot's command ends with what it started.** `run_shell` and the other commands already wait for their end; what they leave running in the background now ends with them, and the tool's description says to use `start_program` for what keeps running.
- **A program of `start_program` belongs to the bot's screen.** It runs under `botdot-run --keep`, which stays while anything it started runs, with the screen in `SCREEN`, and ends with the screen: its rest, its end at the bot's deletion, a restart. Then whatever still carries that `SCREEN` is killed. A bot's commands carry only the screen's `DISPLAY` and go on.
- **What is left anyway is said, not ended.** botdot reads "Not on a bot's screen" every two minutes; more than 100 processes or more than one CPU there, at three checks in a row while no bot runs, is logged once with its largest groups by name and parent, and its line in the computer's status says "Left behind". A restart of the computer clears it.

## Alternatives

- **Make every computer again at once with an init.** It would lose what apt installed on each; the next Update brings the init instead, and `botdot-run` covers the time between.
- **A cgroup per run.** It is what contains `setsid` for sure, but it needs cgroups handed into the computer, which botdot does not do; a subreaper holds what botdot starts without them.
- **End what is left behind by itself.** botdot cannot tell what a bot ran on purpose as root from what was left; it says so, and the owner or the Chief restarts.

## Consequences

- A `nohup server &` through `run_shell` no longer survives the command; a bot uses `start_program`, whose program ends with its screen.
- Each command has one more process, `botdot-run`, which counts with the bot that ran it.
- A computer made before keeps `sleep` as PID 1 until its next Update: what is started outside botdot's calls (a root daemon a bot started through sudo outside a command) can still leave zombies there.
