# ADR-062: A message to a busy bot starts beside the run that is going

- **Status:** Accepted (by the owner, 2026-10-22)
- **Owning task:** [#333](https://github.com/Kordal/bot-dot/issues/333)
- **Changes:** [ADR 011](011-a-bot-does-one-thing-at-a-time-and-the-owners-message-waits.md) ("A bot does one thing at a time"), for messages

## Context

A bot did one thing at a time (ADR 011): every message to a busy bot waited until its run ended. ADR 040 added Steer, which hands the owner's waiting message into the run that is going, and ADR 049 woke a bot for its notes once it was free. Neither helps when the run that is going is long and about something else.

On 2026-10-22 one bot asked another for help with a priority message ("it picks it up when free"). The other bot was busy with a long run of its own, so the request waited in its queue, the bot that asked waited for the answer, and the owner waited for both. The owner asked that a message to a busy bot start a new run instead, and chose on a card: every message, the owner's and the bots', up to three runs of one bot at once.

What already went side by side: the bots of an account all work on one computer at the same time (ADR 035), a bot's helpers work in parallel inside one run (#226), and the turns of a group message sent with `@all` (#124). Each run has its own record, process, MCP and settings files, keys, steer hook and reply draft; none of these is the bot's alone.

## Decision

- **A message starts beside the runs its bot has going, up to three at once** (`RUNS_MAX` in `lib/bots.js`). A message is: the owner's message (typed, a tapped answer, a Board tile's request), a run the Chief asks for, a teammate's priority message (and a reply sent back to a teammate), the notes that wake a bot (ADR 049), a turn in a group (ADR 019), and the answers a bot waited for (`trigger: "replies"`) once the run that asked has ended.
- **Past three it waits, as before.** The fourth message waits in the bot's queue, in the same order as ADR 011 gives (the owner's first, in the order sent), and starts as soon as one of the runs ends. Steer (ADR 040) still hands a waiting message into the run that is going; a steered message waits for that run and does not start beside it.
- **Other work still waits until the bot is free.** A job's run, a call (ADR 026), a script's follow-up, a run that carries on after an OK (ADR 009), the memory review and a new bot's first message start only when no run of the bot is going, as ADR 011 has it. A message never waits behind them.
- **The answers a bot waited for wait for the run that asked.** That run still goes on with what it has; its follow-up starts when it has ended, beside any other run.
- **Nothing else about a run changes.** Each run has its own chat entry, record, working line and Stop. The bot is `running` while any of its runs goes. Its computer stays on while any of its runs needs it. Runs of one bot share its folder and its screen, as its helpers do.

## Alternatives

- **Only a teammate's request starts beside the run** (offered on the card). It fixes the case that started this, but the owner's own message to a busy bot would still wait. The owner chose every message.
- **No limit.** A bot that many teammates ask at once, or a loop of messages, would start one Claude Code process each on a machine with no swap. Three keeps the load of one bot bounded, as the ten places of the queue bound what waits.
- **Keep one run and rely on Steer.** Steer hands a message to a run busy with something else; the run then does both, one after the other, and a teammate's request cannot be steered at all (ADR 040).
- **Duplicate the bot** (#227) for parallel work. That is a second bot with its own chat; the owner wants the same bot to answer.

## Consequences

- A busy bot answers a new message at once; up to three replies of one bot can be in the works in its chat, each in its own row.
- Two runs of one bot can step on each other on its computer or on a server (the prompt already tells a bot to make changes outside its folder one at a time, for its helpers). The cap of three keeps that small; a run that needs the bot alone should be a job, which waits until the bot is free.
- More Claude Code processes run at once: up to three per bot instead of one.
- The apps follow every run that is going in a bot's chat (its draft and files), not only the oldest. An older app still shows each run when it ends.
- A bot can have more than one run waiting for the owner's OK, each with its own card (ADR 056).
