# ADR-046: A run ends on its result line, not when its process exits

- **Status:** Accepted
- **Owning task:** [#207](https://github.com/Kordal/bot-dot/issues/207), part of [#203](https://github.com/Kordal/bot-dot/issues/203)
- **Supersedes:** in [ADR 012](012-a-run-keeps-who-ended-it-and-a-stop-ends-what-its-turn-started.md), a Stop that comes between a run's result line and its exit

## Context

A bot's run and a Chief's turn ended when Claude Code's process closed. Claude Code writes its `result` line, with the reply, and only then exits: 0.5 s later with its non-essential traffic on, more under gVisor (measured 2026-10-20 for #203). For that time the reply was written but not shown, and the owner's next message waited.

ADR 012 kept that moment: "A reply that was whole when the Stop came (its result read, its process not yet gone) stays a reply that succeeded, unless the Stop ended a run", and a bot's run that the owner stopped then was `stopped` whatever it had written.

## Decision

- **The `result` line ends the run or the turn**: its status, its reply, the notification, what waited for the bot or the chat, a group's next turn. What Claude Code writes after it is not read.
- **What the process uses goes once it has exited**: its prompt, MCP and settings files, its skill pack, and the bot's computer when no other run needs it. A run of the bot that started meanwhile keeps the computer on. A hold of the computer (`keep_computer_on`, #340) starts on the result, so the owner's message that waited ends it.
- **A process still there `KILL_AFTER_MS` after its result is asked to end** (SIGTERM), and killed (SIGKILL) after as long again, as a Stop ends one.
- **A Stop after the result finds nothing going**: the run or the reply stays as it ended.
- **A start that may have been signed out still ends on its exit**: an error result before any step, on a server with users per bot, waits for the exit, and whether it was signed out is read from everything it wrote, as before.

## Alternatives

- **Claude Code's non-essential traffic off alone** (#205): the exit comes sooner, but it is still waited for.
- **Keep the Stop of ADR 012 in that moment**: a Stop then would undo a reply the owner can already see.

## Consequences

- A reply, and what waits behind it, comes about half a second sooner, more under gVisor.
- The Chief's next turn in a chat may start while the previous turn's Claude Code is still exiting, on the same session (`--resume`). Claude Code has written the session before its result line; not seen to be a problem, not measured on hq.
