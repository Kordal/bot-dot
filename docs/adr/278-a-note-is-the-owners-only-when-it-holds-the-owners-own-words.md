# ADR-278: A note is the owner's only when it holds the owner's own words

- **Status:** Accepted (spec in [#1711](https://github.com/ladrok/bot-dot/issues/1711))
- **Owning task:** [#1711](https://github.com/ladrok/bot-dot/issues/1711)
- **Amends:** [ADR 015](015-the-server-records-who-said-a-note.md) (when a note is "the owner said"), [ADR 017](017-the-chief-files-a-note-with-a-bot-in-the-owners-turns.md) ("it is never `bot`") and [ADR 059](059-a-note-is-saved-without-an-ok.md) (what a changed note becomes)

## Context

ADR 015 makes a note "the owner said" when it is saved in a run the owner started, before that run read outside content. The rule looks at *when* the note was saved and never at *what* it says. A bot that infers a fact from a task saves its guess as the owner's word: "Find me a vegan lasagne recipe" becomes "The owner is vegan.", marked "the owner said". Such a note is never unpinned to make room, the weekly review may not touch it, and the source rule says it beats the bot's own conclusions (ADR 015). One sentence of a task, or a question ("Should I switch to Rust?"), is enough to put a fact in the owner's mouth for good.

OpenMausBot (`server/memory-capture.ts`) keeps a fact only when it comes with the person's own words, copied exactly, found in what they wrote.

## Decision

- **A note is the owner's only when both hold:** ADR 015's rule says owner (unchanged), and the words the owner said are found in what the owner wrote that this run was handed.
- **The words come with the call.** `remember` and `update_memory` of a bot, and the Chief's `remember` and `update_note`, take an optional `quote`: the owner's words the note rests on, copied exactly. A bot's instructions (`WHAT_TO_SAVE`) say to quote the owner when saving what they said, and never to quote a task as if it were a fact about them.
- **What the owner wrote that a run was handed** is, for a bot: the run's task message; the owner's messages it took while it went (steers, an answer to its questions); and the owner's lines in its conversation block or in the group's chat. A teammate's, the Chief's and botdot's messages and any outside content are never the owner's words, and neither is a request the owner did not type though they started the run: the main assignment that "Run" fills in, a Board tile's message, and a follow-up's task with teammates' replies in it. A run that carries on after an OK or a restart holds the request of the run it continues, so it counts as that run's first request of the chain does (`chat-history.js ownerWords`). For the Chief it is the owner's messages in the chat of the turn, the one that started it included.
- **The comparison** ignores case, spacing, quote marks and end punctuation, and wants whole words in order. A quote of fewer than two meaningful words does not count. It is one function, `found` in `lib/owner-quote.js`, which the bots' route and the Chief's route both ask.
- **Otherwise the note is saved as `bot`,** the bot's conclusion, and nothing is refused. The tool's answer says so in the server's words: kept as its own conclusion because the owner's words were not quoted, and that saving it again with a quote makes it the owner's (a second save of the same sentence is the duplicate key of ADR 015, which lets the owner's source win).
- **The same rule covers a change** (`update_memory`, `update_note`): a changed note is the owner's only with a quote found in what the owner wrote, and the bot's otherwise. It covers the Chief filing a note with a bot, for everyone or for itself: before the turn read anything else, a note is the owner's with a quote found and `bot` without one; after it read something, `outside` as before.
- **The quote is checked and thrown away.** It is not stored on the note or its versions, never shown on a chip or a card, and no model is handed it back.
- **Unchanged:** a note the owner typed in an app; the duplicate key (the owner saying a sentence again still makes it theirs); the rules for a run that read outside content (`outside`), a job's run and the review (`bot`); and every note saved before this change.

## Alternatives

- **The model says it is the owner's** with a flag. It is the very guess this ADR distrusts.
- **Refuse a note without a quote.** A bot that concludes something useful ("the CI takes 12 minutes") would lose it; a bot's own conclusion is worth keeping, marked as such.
- **Judge the note with a second model call** (is this a fact about the owner?). It costs a call for every save and it is a guess again; a substring the server can see is not.
- **Keep the quote on the note** to show the owner. It would grow every note and print text the owner wrote into a place they do not look at; the owner reads their own words in their chat.
- **Also ignore a quote that stands in a question or after "suppose"** (OpenMausBot). It needs a parser for every language the owner writes in; the live scenarios (`w12-a-question`) check that the bots do not quote a question as a fact.

## Consequences

- **A bot that forgets `quote` saves the owner's word as its own conclusion,** which a full pinned set may unpin and the review may rewrite. The cost is a weaker note, never a wrong one, and the bot's answer says how to mend it. The live write scenarios (`test/live/grading.js`) show whether the instruction holds.
- **A quote may still be found in a task** ("Find me a vegan lasagne recipe" quoted as "vegan lasagne recipe"). The server cannot read what a sentence means; the instruction forbids it and `w11-a-task-not-a-fact` grades it.
- **A note that the owner dictated and a bot saved from memory of an earlier chat** (not in this run's chat block) is the bot's. The owner's words reach a run only as far as its block reaches (the last exchanges of the chat), the same reach as its conversation.
- **A change in a clean run no longer keeps a note the owner's** without a quote: ADR 059's "no longer the owner's word" now holds for every bot change.
- **The Chief's filed notes can be `bot`,** which ADR 017 ruled out ("a turn that could only conclude writes nothing"). The chip of such a note says "its own conclusion".
