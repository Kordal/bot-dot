# ADR-133: A screen and its browser are one run's at a time

- **Status:** Accepted
- **Owning task:** [#847](https://github.com/Kordal/bot-dot/issues/847)

## Context

On the account's External Virtual PC (ADR 096) every boat bot shares one desktop (`:0`) and one Camoufox with one profile, because boat.dev streams only `:0`. Nothing kept two runs apart there: their clicks and keys interleaved, a screenshot showed the other bot's windows, a snapshot by one made the other's refs stale, a `goto` changed the other's page, and a saved login was typed into whatever field the other bot focused last. The bridge's own queue keeps single requests apart, not a sequence of snapshot, click and type. On this machine's computer each bot has a screen of its own (ADR 035), but its up to three runs (ADR 062) share it, with the same effect.

## Decision

- **A screen is held by one run at a time.** A screen is the account's External Virtual PC for every bot on it, a bot's own boat.dev machine for that bot, or a bot's own screen on this machine's computer. The hold lives in botdot's server (`lib/screen-lock.js`, used by `lib/computer-screens.js`), not on the machine.
- **The screen tools take it:** the computer-server commands (click, type, key, screenshot…), the browser tools, the typing of a saved login, `start_program` and a screenshot attached for the owner. `run_shell`, `read_file`, `write_file` and the Vault's one-command tools never take it and stay parallel.
- **A lease, renewed by use.** Each screen tool renews the run's hold. It is let go when the run ends, however it ends (finished, stopped, failed, timed out), and after 2 minutes without a screen tool, so a run that moved on to shell work or hangs frees it by itself.
- **A short wait, then a plain refusal.** Another run waits up to 20 seconds, which covers a run that is just ending, then gets an error that names the bot that holds the screen (or "another run of yours"), when it is free at the latest, and that its shell and files work now. Nothing of the refused call reaches the screen.

## Alternatives

- **A queue with a long wait.** A tool call that blocks for minutes looks hung to the bot and holds its run; a refusal it can read lets it do other work and try again.
- **A lock per tool call only.** The bridge already serialises single requests; the harm is between calls of one sequence.
- **A browser context per bot in the bridge.** It would keep refs and the focused page apart, not the mouse, keyboard and screenshots of the one desktop.
- **Holding the screen for the whole run.** A run that used the browser once would keep every other bot off it until it ends.

## Consequences

- A run that thinks for more than 2 minutes between two screen tools can lose the screen to another run and gets the refusal on its next one.
- A run that keeps using the screen keeps it for as long as it does; other runs are refused until it is done.
- The hold is in memory: a restart of botdot lets go of every hold, as it ends every run.
