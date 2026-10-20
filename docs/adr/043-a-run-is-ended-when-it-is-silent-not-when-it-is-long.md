# ADR-043: A run is ended when it is silent, not when it is long

- **Status:** Accepted
- **Owning task:** [#187](https://github.com/Kordal/bot-dot/issues/187)
- **Supersedes:** the 60 minutes of [ADR 012](012-a-run-keeps-who-ended-it-and-a-stop-ends-what-its-turn-started.md)

## Context

ADR 012 ends every bot run and every Chief turn 60 minutes after its start, whatever it does, so that nothing holds the work that waits behind it for ever ([ADR 011](011-a-bot-does-one-thing-at-a-time-and-the-owners-message-waits.md)). It rejected a watchdog for silence: "Claude Code already ends a run whose model or tool is silent; what is missing is an end for a run that keeps going."

On 2026-10-20 Claude Coder on hq.botdot.app was rebasing a pull request, one Bash step after another, and was ended at 60 minutes in the middle of it ("I stopped after 60 minutes: this took too long."). The line "Privilege broker: Privilege broker disconnected" just above was the stop itself: the relay of the run's process (`lib/privilege-client.js`) closed its socket on the SIGTERM before the exit came. The owner: a run that is still working should not be ended.

The longest a run is silent while it is fine is one wait inside it: a tool call of botdot's own (`MCP_TOOL_TIMEOUT`, 15 minutes for a bot, 10 for the Chief), the owner's OK on an action in a connected app (10 minutes), a Bash command (10 minutes at most).

## Decision

- **A run and a Chief's turn are ended after 20 minutes without a line from Claude Code** (`endedBy: "idle"`). Each line on its stdout (a step, a tool's result, a word of the reply) starts the 20 minutes again. 20 is above every wait listed above.
- **A ceiling stays: 4 hours from the start** (`endedBy: "limit"`), counted as ADR 012 counts the 60 minutes. A run that goes round in circles still ends, and what waits behind it starts.
- **Both are a run that failed**, with their own sentences (`lib/problems.js`), as the limit was: passed on to the Chief, the card of a connected-app action stays, a late yes carries on.
- Two constants on the server (`RUN_IDLE_MS`, `RUN_LIMIT_MS` in `lib/bots.js`), no setting; tests set them short with `BOT_DOT_RUN_IDLE_MS` and `BOT_DOT_RUN_LIMIT_MS`.

## Alternatives

- **A longer total only** (e.g. 3 hours). Still ends a run that works, only later; and a stuck run then holds the queue for hours instead of 20 minutes.
- **Silence only, no ceiling.** A run that loops for ever, writing as it goes, would hold its bot and what waits behind it for ever, against ADR 011.
- **A setting per account or bot.** Against the rule of no new settings (AGENTS.md, Minimal UI).

## Consequences

- A run that keeps working gets up to 4 hours; a stuck one ends after 20 minutes instead of 60.
- An app that does not know `"idle"` draws the server's `problem`, as for any run that failed: Android already does; the web page has the sentence too.
