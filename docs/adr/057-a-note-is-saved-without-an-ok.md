# ADR-057: A note is saved without an OK

- **Status:** Accepted (by the owner, 2026-10-22)
- **Owning task:** [#290](https://github.com/Kordal/bot-dot/issues/290)
- **Changes:** [ADR 015](015-the-server-records-who-said-a-note.md) (a change to what the owner said, and a shared addition or change after outside content, waited on a card)
- **Supersedes:** the shared-notes part of [ADR 055](055-always-allow-on-more-cards.md) ("Always allow for this bot")
- **Widens:** [ADR 025](025-what-a-run-did-is-no-row-under-a-reply.md), as [ADR 050](050-a-bot-saves-a-skill-it-wrote-without-an-ok.md) did for skills (a note that once waited is a row under the reply)

## Context

Since ADR 015 three note cards came to Needs you: "Add to the shared memory" and "Change in the shared memory" when a bot's run had read outside content, and "Change what you said" when a bot or the Chief changed a note the owner said in a run or turn that was not clean. A bot that works in a group, reads its computer or the web, or was started by a teammate hits them in almost every run, and the cards hold a bot's routine bookkeeping ("step 1 done"). ADR 055 offered "Always allow for this bot" for the shared ones; the owner then said these need no confirmation at all.

## Decision

- **An addition or a change to a note is saved at once, in every run and every Chief turn.** Its own notes, the shared ones, and one the owner said. No card.
- **The source stays the server's (ADR 015).** A note saved after outside content says "after outside content". A changed note of the owner's is no longer the owner's word: it becomes the bot's or "after outside content", and is unpinned like any other when room is needed. Its earlier version stays in the note's history and can be brought back.
- **What once waited is a row under the reply** (`told` on the run's learned item): a shared note saved or changed after outside content, and a change to what the owner said. The Chief's note changes already had their chip.
- **Still on a card:** a removal of a shared note after outside content, a removal of what the owner said outside a clean run or turn, and a forget (ADR 016). A job's run and the memory review still never change or remove what the owner said: refused, no card.
- **"Always allow for this bot" is gone.** `sharedNotesAlways`, `DELETE /api/bots/:id/shared-notes-always`, the card's `always`/`alwaysAsk` and the "Changes to shared notes" line under "Always approved" are removed. A stored `sharedNotesAlways` is dropped on the bot's next save. The Chief's "Always allow <type>" of ADR 055 stays.

## Alternatives

- **Keep "Always allow for this bot".** Still one card per bot, and none for "Change what you said", which was the card the owner pointed at.
- **Save at once only the shared notes, keep the guarded change.** The guarded change is the most frequent one in groups; the owner asked for it to go.
- **Save at once but hold what the owner said.** That is the card again, under another name.

## Consequences

- A prompt-injected bot can write what a page told it into every bot's memory, or rewrite what the owner said, without a card. Every such note is marked "after outside content", shown under the reply, kept with its history, and removable by chat; removing it in bulk still waits for the owner.
- What the owner said can now drift through a bot's rewrites. The owner says it again to make it theirs, or asks for the old version back.
- Waiting add/edit changes from before stay in Needs you and are answered as before; no new ones are made.
- An app from before shows no "always" on memory cards and no "Changes to shared notes" row, as the server sends neither.
