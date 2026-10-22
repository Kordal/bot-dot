# ADR-060: The pinned set is not the owner's business

- **Status:** Accepted (by the owner, 2026-10-22)
- **Owning task:** [#309](https://github.com/Kordal/bot-dot/issues/309)
- **Changes:** [ADR 015](015-the-server-records-who-said-a-note.md) ("Every unpin is in the tool's answer") and [ADR 024](024-a-done-memory-change-is-no-row-under-a-reply.md) ("The bot's reply carries the signal"), for the pinned set only

## Context

A bot saved the owner's decision, could not pin it because the pinned set was full of what the owner said, and asked the owner which pinned note could go. The note was saved all along: the lookup before each run (words and meaning) and `recall` find it. The question came from the bot's prompt ("say so", "you say that too") and from the memory tools' answers ("Tell the owner that; they decide which pinned note can go", "Tell the owner which"). The kept-in-mind files (#235) did the same with "Unpin one first". The owner, on 2026-10-22: the user does not need to know about it, the bot does not need to ask, and when a note goes to search only the bot writes nothing to the user.

## Decision

- **Memory decides by itself what stays pinned.** The prompt says so, and that a bot never mentions pinned slots or a full memory and never asks the owner what to unpin. Making room works as before (ADR 015): what the owner said and what the owner pinned stay; the bot's own and outside notes leave first.
- **No memory tool's `say` speaks of the pinned set.** `remember`, `update_memory`, `restore_note`, `set_pin` and the Chief's tools no longer name the notes that left it or a note that did not fit, and tell no one to tell the owner. The answer's `unpinned` still lists them, and the run still records them; no app shows them (ADR 024).
- **A note saved to search only is not reported.** `remember` answers `Saved to your memory as [id]. Recall finds it when it matters. Say nothing about this save to the owner.`, and the prompt says to leave such a save out of the reply.
- **A refusal points to the next step, not to the owner.** A longer text for a pinned note of the owner's that no longer fits is refused with "keep it as short as it was, and save what you wanted to add as a new note with remember". A bot's `set_pin` on a full set answers that the note stays searchable and that nothing else is to be done.
- **Files are kept in mind by the owner's choice.** A bot's `pin_file` on a full set (5 files) answers that only the owner changes which, and that decisions and facts are saved with `remember`, not as a file. The owner's own pin in the bot's settings keeps "Unpin one first".
- **The pinned set holds 10,000 characters** per bot and for the shared memory, up from 5,000; still 30 notes.

## Alternatives

- **Keep telling the owner, in fewer words.** Any word about slots invites the question back; the owner asked for none.
- **Pin the owner's newest note by unpinning their oldest.** It would break ADR 015's rule that what the owner said stays; the lookup already brings back what matters.

## Consequences

- A bot's prompt with every cap hit is some 10,000 characters longer (the two memory blocks): the bound test is now 114,000 characters (110,568 measured in plain words, 112,144 with every text made of tags).
- What a forget erased is still told to the owner (ADR 024): that is not the pinned set.
