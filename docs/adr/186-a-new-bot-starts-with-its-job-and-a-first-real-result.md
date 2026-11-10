# ADR-186: A new bot starts with its job and a first real result

- **Status:** Accepted (2026-11-10, the owner's go on "less heavy, less minding the bots")
- **Changes:** the Chief's skill bot-designer: a first run only when the owner said "now"; else the bot's own first message (#511)
- **Keeps:** #511 (a new bot that has no chat by then writes its first message), ADR 064, every card a job or a login needs

## Context

A bot the Chief made waited: its job was added once the owner asked again, and its first run came when the owner said "now". Owners made a bot, saw a greeting, and had to come back to get it going.

## Decision

- **Its job in the same turn.** The Chief adds a new bot's jobs with `create_bot`, unless what the job needs still waits (a login, a card). An AI job is approved at once; a script job still waits on its card.
- **A first real result.** The Chief then starts the bot with `run_bot` for one round of its job, not a greeting, with a first-run checklist that leaves sending, posting, buying and deleting for the owner's OK, and reports in one line what it found.
- **What waits.** When a login or a card waits, the Chief says so, and adds the job and starts the first run when botdot tells it the card is answered.
- **No first run** for a bot whose whole job is to act on the world (send or post), or when the owner said to wait: the bot's own first message then, as before.

## Alternatives

- **botdot starts the first run by itself after create_bot.** Rejected: the Chief knows which logins and cards the job needs, and the checklist; a run without them fails and makes the owner mind it.

## Consequences

- A new bot is working, with a result, before the owner leaves the chat.
- One more run per new bot, on the owner's Claude plan.
