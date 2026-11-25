# ADR-277: The weekly review settles notes that cannot both be true, and removes at most a quarter

- **Status:** Accepted
- **Owning task:** [#1714](https://github.com/ladrok/bot-dot/issues/1714)
- **Builds on:** [ADR 015](015-the-server-records-who-said-a-note.md) (the review leaves what the owner said alone), [ADR 016](016-a-forgotten-note-is-erased-and-a-removed-one-ends.md) (remove, and 30 days to bring a note back), [ADR 059](059-a-note-is-saved-without-an-ok.md) (a removal from the shared memory waits for the owner), [ADR 178](178-cards-that-guarded-nothing-are-gone.md) (a removal is saved at once), [#117](https://github.com/ladrok/bot-dot/issues/117) (the Chief's memory review)

## Context

The weekly review merges duplicates and updates outdated notes, but it is not asked for two notes that cannot both be true ("The staging database listens on 6543" from March, "Staging is on port 5433" from October). Both stay, and the lookup hands a run either one. Nothing limits what one review removes, so a bad review could empty a bot's memory in one go; a removed note can be brought back for 30 days, but nobody would notice in time.

The Chief's own review (#117) reads the Chief's notes and the shared ones with no tools, and changed nothing until the owner's yes on a card.

The first version of this decision let the Chief's review remove a losing note at once, shared ones too. The owner changed that: the shared notes are what every bot reads about the owner, and ADR 059 has a removal of such a note wait for the owner's OK. A contradiction does not make the removal safer: the review may have taken the wrong note for the newer one, and every bot would act on what is left.

## Decision

- **A step in the review's prompt.** Find pairs of notes that cannot both be true now. Keep the newer one unless the older one is clearly the correction; remove the other with `remove_note`, with a reason that names the note it lost to.
- **The owner's pair is named, never changed.** Two notes marked "the owner said" that contradict each other are left as they are (ADR 015: the review is refused anyway), and the report says so in one line for the owner. No card.
- **A cap, held by the server.** A run whose trigger is `review` may remove at most a quarter of the bot's notes as they were when it began, and at least 3 (`REVIEW_CAP` and `reviewRemovalLimit` in `lib/bots.js`, beside `REVIEW_LIST`: the one place the number lives). The run's record keeps `reviewRemovals: { limit, used }`. A removal past it is refused: the answer is `result: "refused"` and says the review has reached its limit, and the note stays. A refused removal, and a note the owner said, count for nothing. No other run is limited, and nothing but removals is: the review can still reword and pin.
- **The Chief's review gets the step and the cap, and a shared note waits.** Its answer may hold `settle` (`{ remove, keep, reason }`, ids of notes it was handed) and `owner_pairs`. botdot checks each id against what it handed over and never removes, or proposes to remove, a note the owner said.
  - A loser that is one of **the Chief's own notes** is removed at once, as the Chief (`by: "chief"`), with a reason that names the note it lost to, within the cap; the report in the Chief's chat says each, and the owner can have it brought back for 30 days.
  - A loser that is a **shared note** is not removed. botdot makes a waiting removal (the pending change of ADR 059, `action: "remove"`) and its card in Needs you, "Remove from the shared memory": it shows the note it would remove, and, under it, the newer note it lost to and why. Nothing is approved unseen; the note stays until the owner's yes, and a no is kept as any other. The report says each proposal. A shared note that already has a waiting removal gets no second card.
  - **It acts on the notes as they stand when the review answers.** The review reads the notes before its run, which can take minutes. Right before it removes a note or proposes its removal, botdot reads both notes again, and leaves the entry alone when either is gone, when the one that loses has become the owner's in the meantime (ADR 015), or when either text changed. A skipped entry is not in the report, as a removal that failed is not.
  - The cap counts the removals done at once. A proposal on a card uses none of it, but is kept to the same number (a quarter of the notes it reads, at least 3), so that a review cannot flood Needs you; botdot says the rest is left for the next review.
- **A bot's own review is unchanged.** Its own notes are removed at once within the cap, and what the owner said is refused. A removal of a *shared* note by a bot, in a review as in any other run, is done at once under [ADR 178](178-cards-that-guarded-nothing-are-gone.md) (which took the wait of ADR 059 away) and counts against the cap; this ADR does not change that, because the step this ADR adds is about the notes the bot is handed, which are its own. Whether a review run should leave shared notes to a card too is a separate decision.

## Alternatives

- **No cap, only the prompt.** A review that misreads its notes could remove them all; a sentence is not a limit.
- **A cap on the whole run's changes.** Rewording and pinning keep the note; only a removal takes one out of every bot's reading.
- **A card for every removal.** More cards, for a change that is kept and can be undone (ADR 178).
- **A card kind of its own for the Chief's proposals.** Not needed: the waiting removal of ADR 059 and its card already exist in both apps, with the words "from its memory review".
- **The Chief's review removes shared notes at once, restorable for 30 days.** The first version of this ADR. Rejected by the owner: every bot reads a shared note, and 30 days to notice is the argument ADR 178 used for the owner's own removals, not for a bot's guess about what the owner meant.
- **A fixed number.** A bot with 400 notes would need many reviews to tidy; a bot with 6 would lose half. A share with a floor scales.

## Consequences

- A review of a bot with 100 notes may remove 25; a small memory, 3.
- The Chief's weekly report may now end with cards waiting in Needs you: one for each shared note that lost a pair. A review that finds no pair of shared notes behaves as before.
- The card's second line carries the reason (`cardOf` in `lib/learning.js`): `from its memory review: lost to “…”`, so no app changes.
- The prompt of every bot's review is a few lines longer, and its steps after the third move down by one.
- The live review eval has a scenario for the pair and the owner's pair (`r07-cannot-both-be-true`).
- A model may leave a pair alone; the step asks for it, and nothing checks that every pair was found.
