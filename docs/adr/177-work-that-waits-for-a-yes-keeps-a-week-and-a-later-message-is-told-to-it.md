# ADR-177: Work that waits for a yes keeps a week, and a later message is told to it

- **Status:** Accepted (2026-11-10, the owner's go on "less heavy, less minding the bots")
- **Changes:** [ADR 009](009-the-botdot-server-carries-on-after-an-ok.md) (how long what waits carries on, and what a later message of the owner's does to it)
- **Keeps:** [ADR 009](009-the-botdot-server-carries-on-after-an-ok.md) (what carries on and in whose name), [ADR 020](020-a-member-reads-the-groups-chat-and-keeps-its-own-memory.md) (a message counts in the chat it was sent in), [ADR 166](166-a-run-that-carries-on-goes-on-in-the-stopped-runs-session.md)

## Context

Owners said botdot feels heavy and that they have to mind their bots by hand. One reason: work that stopped on a card was dropped for good 24 hours after the card appeared, and also as soon as the owner wrote anything else to that bot. Answering a card the next evening, or after a quick unrelated question to the bot, gave the setting and nothing more: the owner had to send the request again.

## Decision

- **A week.** What waits for a card carries on for seven days after it appeared (`CARRY_HOURS` in `lib/asks.js`), for a bot's runs and for the Chief's own turn alike.
- **A later message drops nothing by itself.** A run carries on although the owner wrote to that bot since, in the chat that run is in. Only a later request of the owner's that waits for the same card takes its place, as before: of two requests refused the same, the later carries on.
- **The run is told what the owner wrote since.** `whatCarriesOn` gives the run `since`, the ids of those messages. The carry-on prompt quotes them, the last three, word for word, and tells the bot not to redo what they replaced or already got done (`sinceNote` in `lib/bots.js`). The bot, which reads both, decides; botdot does not guess.
- **The Chief's own turn** still ends once the owner wrote in that chat since it asked: there, the owner speaking to the Chief about it is the Chief's context already.

## Alternatives

- **A model call at the yes** to decide whether the later message replaced the request. Rejected: one more call and one more thing to be wrong, where the bot that carries on reads the same words anyway.
- **Keep 24 hours.** Rejected: an owner away for a weekend found the work gone.

## Consequences

- A yes after days still does what was asked. A bot may now and then answer "already done" in one line, where before nothing ran.
- The card's `then` promises the carry-on in more cases, so cards stay longer in Needs you, up to the week.
