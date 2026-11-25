# ADR-277: The weekly review settles notes that cannot both be true, and removes at most a quarter

- **Status:** Accepted
- **Owning task:** [#1714](https://github.com/ladrok/bot-dot/issues/1714)
- **Builds on:** [ADR 015](015-the-server-records-who-said-a-note.md) (the review leaves what the owner said alone), [ADR 016](016-a-forgotten-note-is-erased-and-a-removed-one-ends.md) (remove, and 30 days to bring a note back), [ADR 178](178-cards-that-guarded-nothing-are-gone.md) (a removal is saved at once), [#117](https://github.com/ladrok/bot-dot/issues/117) (the Chief's memory review)

## Context

The weekly review merges duplicates and updates outdated notes, but it is not asked for two notes that cannot both be true ("The staging database listens on 6543" from March, "Staging is on port 5433" from October). Both stay, and the lookup hands a run either one. Nothing limits what one review removes, so a bad review could empty a bot's memory in one go; a removed note can be brought back for 30 days, but nobody would notice in time.

The Chief's own review (#117) reads the Chief's notes and the shared ones with no tools, and changed nothing until the owner's yes on a card.

## Decision

- **A step in the review's prompt.** Find pairs of notes that cannot both be true now. Keep the newer one unless the older one is clearly the correction; remove the other with `remove_note`, with a reason that names the note it lost to.
- **The owner's pair is named, never changed.** Two notes marked "the owner said" that contradict each other are left as they are (ADR 015: the review is refused anyway), and the report says so in one line for the owner. No card.
- **A cap, held by the server.** A run whose trigger is `review` may remove at most a quarter of the bot's notes as they were when it began, and at least 3 (`REVIEW_CAP` and `reviewRemovalLimit` in `lib/bots.js`, beside `REVIEW_LIST`: the one place the number lives). The run's record keeps `reviewRemovals: { limit, used }`. A removal past it is refused: the answer is `result: "refused"` and says the review has reached its limit, and the note stays. A refused removal, and a note the owner said, count for nothing. No other run is limited, and nothing but removals is: the review can still reword and pin.
- **The Chief's review gets the step and the cap.** Its answer may hold `settle` (`{ remove, keep, reason }`, ids of notes it was handed) and `owner_pairs`. botdot checks each id against what it handed over, never removes a note the owner said, removes at most the same limit (counted from the Chief's notes and the shared ones it reads) and says the rest is left for the next review. What it removes goes at once, as the Chief (`by: "chief"`), with a reason that names the note it lost to, and the report in the Chief's chat says each, so that the owner can have it brought back for 30 days. Its skills still wait on cards.

## Alternatives

- **No cap, only the prompt.** A review that misreads its notes could remove them all; a sentence is not a limit.
- **A cap on the whole run's changes.** Rewording and pinning keep the note; only a removal takes one out of every bot's reading.
- **A card for every removal.** More cards, for a change that is kept and can be undone (ADR 178).
- **The Chief's review proposes a removal on a card.** A card kind of its own in the apps for a change that comes back for 30 days; the report in its chat says what was done instead.
- **A fixed number.** A bot with 400 notes would need many reviews to tidy; a bot with 6 would lose half. A share with a floor scales.

## Consequences

- A review of a bot with 100 notes may remove 25; a small memory, 3.
- The prompt of every bot's review is a few lines longer, and its steps after the third move down by one.
- The live review eval has a scenario for the pair and the owner's pair (`r07-cannot-both-be-true`).
- A model may leave a pair alone; the step asks for it, and nothing checks that every pair was found.
