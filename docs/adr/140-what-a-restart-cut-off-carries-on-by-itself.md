# ADR-140: What a restart cut off carries on by itself

- **Status:** Accepted (asked for by the owner, 2026-11-02)
- **Owning task:** the owner's question in the project chat, "When the server is updated, do bots resume the work automatically?"
- **Changes:** [ADR 009](009-the-botdot-server-carries-on-after-an-ok.md) (what carries on, and when)

## Context

An update from the admin page, a restart of the account's container or a crash stops the botdot server in the middle of its work. What waited is kept and starts again: the bots' queues (`queue.json`), the Chief's waiting turns, the groups' lines, one-time jobs due while botdot was off. What was going is not. Each bot run that was going is marked `interrupted` as the next server starts (`lib/bots.js`), each Chief reply that was being written is marked "cut off" (`lib/chief.js`), and nothing starts them again. The owner had to notice and ask a second time, and a group's line went on without the member that was cut off. Updates are pressed while bots work, so this happened with every update.

## Decision

- **A bot's run that a restart cut off carries on by itself**, once the scheduler starts and before what waited (`carryOnAfterRestart`). It is the same work a yes on a card starts ([ADR 009](009-the-botdot-server-carries-on-after-an-ok.md)): a `carry-on` item under the key `carry:<run id>`, kept in `queue.json`, which starts a new run with `continues` set to the cut run. Its prompt says, in botdot's words, that the run was cut off by a restart, and gives the request word for word, the reply it had written and `read_run` with the cut run's number, so the bot does not do twice what it did.
- **The rules are those of a yes** (`lib/asks.js whatCarriesOn`, with `startsBot`): nothing carries on once the bot is gone, the owner stopped the run, or the owner sent the bot a message in that chat after the run was cut. A job's run carries on only while its job is there and approved, the bot is not paused and the job did not run again. A run the Chief started carries on as the bot's run, with no Chief turn. A turn in a group carries on in that group, and its line waits for it. A memory review is not carried on: it runs at its own time.
- **A job's run goes on from where it was**, with the carry-on prompt, and is not run again whole as after a yes: run whole it would do twice what it had done.
- **The Chief's reply to the owner that a restart cut off carries on** (`carryOnCutReplies`), first of what waits in that chat. It is a turn of botdot's, told the owner's message word for word, the names of its files and what the reply had written, since the session it resumes may not hold that message. As every turn of botdot's it has no connected apps and is not steered. A turn of botdot's that was cut off is not carried on.
- **Only when botdot was back within an hour**: the last minute the scheduler of the server before looked at its jobs (`scheduler.json lookedAt`) is at most an hour before this start. After longer, or from data put back from a backup, the owner has moved on, and what they asked then is not done unasked. Nothing is carried on while Claude is signed out for the Chief; a bot's work waits in its queue for the sign-in, as any.
- **Once.** A run that carried on from a run cut off is not carried on again when a restart cuts it off too, so a server that falls over in the middle of one run does not start it forever.
- The cut run stays as it was: `interrupted`, with its `problem`, in the chat.
- **`BOT_DOT_RESTART_CARRY_ON=off` stops it** (the tests of what a restart leaves, which count the runs; `test/helpers.js` sets it unless a test file turns it on).

## Alternatives

- **The update waits until no bot is working.** Rejected as the fix: it does not cover a crash or the machine restarting, a long run would hold an update for hours, and the owner who presses Update wants it now. It can be added later beside this.
- **Resume the run's own Claude Code session (`--resume`).** Rejected: the session id is kept with the run only when the run ends, and a session cut in the middle of a tool call does not always resume. The carry-on prompt with `read_run` works the same for every run and is what a yes already uses.
- **Carry on whatever the downtime.** Rejected: a machine that was off for a night would start yesterday's requests unasked.

## Consequences

- An update while bots work no longer loses their work: each cut run carries on, and its new run is in the chat right after the cut one.
- A bot may repeat a step that the cut run had started and not finished; the prompt tells it to read the cut run's steps first.
- `docs/api.md` says so where it describes a restart.
