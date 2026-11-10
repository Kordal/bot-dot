# ADR-190: The owner's dated to-do starts its bot on its day

- **Status:** Accepted (2026-11-10, the owner's "Tak" on C, #1118, the narrow version)
- **Changes:** ADR 115: only the owner's item due by the day it was added started the bot
- **Keeps:** ADR 115 for the Chief's and the bots' items: they wait for the bot's turn, so bots adding items for each other start no chain of runs

## Context

The owner gave a bot an item due Friday, or every Monday, and the calendar drew it on that day. Nothing started the bot when the day came. The owner thought the work was scheduled and found it overdue.

## Decision

- **On its day.** The owner's item for a bot (`by: "you"`) that is due today is given to the bot as the owner's message, as when it is added for today. botdot looks every 15 minutes, outside the quiet hours, so Friday's item starts on Friday morning.
- **Once per due day.** The item keeps `started`, the day it was given for. A repeat's next item comes from the tick and has none, so it starts on its own day.
- **Not an old list.** An item due before yesterday is not started: turning this on must not start a month of items at once. Yesterday's is, for a restart over night.
- The Chief's and the bots' items start nothing, as before.

## Consequences

- "Every Monday: send the numbers" works without a job.
- An item the owner moves to another day starts the bot again on that day.
