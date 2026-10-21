# ADR-049: A note to a bot wakes it as soon as it is free

- **Status:** Accepted (by the owner, 2026-10-21)
- **Owning task:** [#225](https://github.com/Kordal/bot-dot/issues/225)
- **Changes:** "anything else waits in its inbox and is read at the start of its next run" (`lib/messages.js`, the bots' messages since Milestone 2)

## Context

A bot messages a teammate with `message_bot`. With `priority: true` the teammate starts now (or waits its turn, [ADR 011](011-a-bot-does-one-thing-at-a-time-and-the-owners-message-waits.md)) and the sender waits for its answer. With `priority: false`, or when the teammate already has ten runs waiting, the message became a note in its inbox, read at the start of its next run, and nothing started that run. The sender picks the flag, and nothing stopped it from leaving a real request as a note.

On 2026-10-21 one bot asked another to add its SSH key to a server. The chat said "Notes waiting" under the other bot, which did nothing: no job or message started it. The owner could not even answer it, since it never ran.

## Decision

- **Every note wakes its bot as soon as it is free.** If the bot is idle, a run starts at once with its notes. If it is busy, one piece of work waits in its queue (`kind: "notes"`, one per bot) and starts when it is free. There is no waiting time.
- **A run that reads the notes first takes them.** Every run of the bot reads its inbox, so a run that starts before the wake (the owner's message, a job) reads them, and the wake starts nothing. A note it has read never starts another run.
- **A full queue takes no wake.** Its next run reads the notes, and the end of every run of that bot asks again, so they never wait for ever.
- **The answers a waiting bot collects wake nothing.** They are notes too (`answer` on the note), and its follow-up reads them once everyone it asked has answered ([awaits.js](../../lib/awaits.js)).
- **A run the notes woke is the teammate's request, in the bot's own chat.** `trigger: "bot"` without `fromBot`; its task says other bots left it messages, never the owner. It is internal: no notification. It goes on in the exchange of the latest note (`hop`, `chainId`, and it may answer that note's sender), so a chain of notes stops at `MAX_HOPS` as messages do.
- **The owner sees and starts them.** The "Notes waiting" line says how long the oldest has waited and has "Run now" (`POST /api/bots/:id/inbox/run`): the bot starts with its notes, or once it is free. That run is the owner's request and notifies as one.
- **The sender is told.** `message_bot`'s result for a note says the teammate starts once free and that nothing comes back, so a request that needs an answer goes with `priority: true`. A priority message that met a full queue says it did not start now (`full: true`).
- On start, botdot wakes every bot that has notes waiting, notes left before this change too.

## Alternatives

- **Wake a note after 10 minutes.** Proposed first, so that several notes are read together. The owner dropped it: a request should not wait, and a busy bot reads them together anyway.
- **Turn every note into a priority message.** The sender would then wait for an answer to an update nobody needs answered, and a busy bot would get one run per note instead of one for all.
- **Only show the owner the notes.** The owner would still have to start every bot by hand.

## Consequences

- A request left as a note is acted on without the owner. A note costs a run of its bot, as a priority message does.
- After the update, bots with notes from the last seven days start once each.
- An app from before draws a run its notes woke as a run with the owner's message (its task), and has no "Run now"; it asks the server's `features` for `notes-wake`.
