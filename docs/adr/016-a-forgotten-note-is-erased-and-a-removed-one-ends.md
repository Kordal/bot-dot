# ADR-016: A forgotten note is erased, and a removed one ends

- **Status:** Accepted
- **Owning task:** MEM-004

## Context

[Milestone 9](../product/milestone9.md). Deleting a note copies it into `note_versions`, which nothing ever empties (`lib/memory.js`, `removeNote`). The server then writes the forgotten text into the forgetting run's `learned` record (`server.js`), which the run index stores and weighs above the reply. The chats where the owner said it stay indexed, and four of the Chief's readers and the look's digest ignore the mark "Don't recall". So "forget what I told you about X" removes one line from a prompt and leaves X in at least four places a model reads, one made by the forget itself ([the memory audit](../product/improvements/2026-10-06-memory-audit.md), finding 1). README promises the opposite of an end: "Deleted notes are kept too."

A note has no end either: "in London this weekend" stays in every prompt until someone deletes it.

On 2026-10-06 the owner decided: a deleted note is purged after 30 days; "forget" reaches what a model reads, not run files, logs or Claude's transcripts; a passing state is kept, with its end, and the bot asks for the end when none was given; "Forget for good" by anything but the owner's own request waits on a card.

Claude's memory stores keep versions for 30 days and have a second verb that scrubs the text; OpenClaw records forgotten sessions so that no re-index restores them, and reports what it could not reach ([research note](../archive/product/milestone9-research.md), section 1).

## Decision

- **Two verbs.** To **remove** a note (no longer true, replaced, deleted, ended) makes it a dated version: hidden from every model unless asked for, restorable for 30 days in a run the owner started, then purged. To **forget** erases at once: the note, every version, its search rows, vectors and waiting changes.
- **A forget leaves runs out.** The runs that wrote the note, and those the bot names from the forget's answer, are recorded as left out. One function decides "left out", and every reader that hands a run's text to a model asks it: recall, the lookup, the conversation block, the review, `read_run`, the Chief's `get_run`, `list_runs` and `wait_for_run`, the look's digest, the Chief's waiting turns and the look's file. A left-out run stays in the owner's own chat history and search.
- **A forget answers with what still matches,** notes and runs, so the bot can extend it in the same turn, and so the reply can say what was not reached.
- **Immediate only for the owner.** In a run or a Chief turn the owner started that has read nothing outside, a forget happens at once. Anywhere else it waits for the owner, on a card that is never part of "Approve all".
- **A run's record of what it learned holds a kind and a note's id, never text.** The chip is written when it is read, from the note as it then stands. The run index is rebuilt once.
- **A note may have an end:** a calendar day, in the time zone schedules follow. Past it the note is removed, with "ended" as the reason. botdot checks before it builds a prompt and at start.
- **A deleted bot is forgotten:** its notes, versions, waiting changes and indexed runs.
- **Forget, approve and decline are audit events,** without the note's text.
- **A forgotten fact is not banned.** Said again, it is saved again.

### Resolved by MEM-004

**Names.**

- A bot's tools: `remove_note` removes, `forget` forgets, `restore_note` brings a removed note back, and `recall` lists removed notes with `removed: true`. The tool that removed a note was called `forget` before; that name now erases. `remember` and `update_memory` take `until`.
- On `POST /api/self/session/memory` the actions are `remove`, `forget` and `restore`; a forget answers `result: "forgotten"` with `erased`, `leftOut` and `still`. A forget that waits is a waiting change with `action: "erase"`. `features` announces `memory-forget`. All of it is in `docs/api.md`, Memory, "The contract".
- In `memory.db`: `until` on `notes`, `note_versions` and `pending`; `detail` on `pending` (the ids a waiting forget names); the tables `note_runs` (the runs that wrote each note), `left_out` (run ids), `forgotten_notes` (note ids) and `erasing` (an erase that has begun). None of the four holds a text. `schema_version` is `3`, `index_version` is `4`.
- A run's record has `forgotten: true` once a forget left it out. A `learned` item of a memory kind is `{ kind, id }` with what its chip needs (`what`, `unpinned` as ids, `count`, `pending`), and no text. The kinds: `memory`, `memory-shared`, `memory-removed`, `memory-restored`, `memory-pin`, `memory-pending`, `forgot`.
- The audit events: `memory.forgotten`, `memory.approved`, `memory.declined`.

**Two marks, one function.** The owner's "Don't recall" stays as it is, and the owner can take it back. A forget sets a second mark that nothing takes back: `PUT /api/memory/runs/:id` with `excluded: false` answers `409` for it. `leftOut` in `lib/memory.js` answers for both, asked with a run's record, its entry in the index or its id, and every reader named in the decision asks it. Since MEM-011 three more do, which the milestone's review found: a bot's earlier run in an exchange with a teammate, a bot's open question as the Chief is handed it, and an unasked message of the Chief's quoted into the owner's next turn. The index keeps the answer in the one column its searches filter on (`excluded`: `0`, `1` for the owner's mark, `2` for a forget), and `left_out` keeps a forget through every rebuild of the index and for a run the index no longer holds.

**The run that forgets is left out too.** Its request names what is to be forgotten ("forget that I see a therapist") and its reply often repeats it. So a forget leaves out the runs that wrote the notes, the runs the bot names, and the run that asks. "The runs that wrote a note" are every run that saved it, changed it or said its sentence again: the server keeps them by their ids (`note_runs`), since a note's own `runId` names only the last, and an earlier version is purged after 30 days. A note from before this decision has its `runId` and its versions' alone. An approved forget leaves out the run that asked for it too.

**What "still matches".** The bot gives the forget its key words (`about`), as it searched with recall. After the erase the server searches the bot's notes, the shared notes, earlier versions, removed notes and the bot's own runs that are not left out, by those words, and answers the best matches: at most ten, each at least half as good as the best. It is a hint: the bot passes back those that hold the same thing, and tells the owner what it could not reach. A bot names only its own notes, shared notes and its own runs; another bot's are refused.

**The Chief's waiting turns and the look's file.** A turn that waits to tell the Chief a bot's result is dropped when that run is left out, and nothing is posted in its place; a result that ends while its run is left out starts no turn. A bot's result that stands unread in a Chief chat is not told to the Chief's next turn; the chat keeps the message for the owner. The look's file keeps its entries: an entry whose message is left out is not handed to a look, neither in the digest nor under "Already raised". Nothing is rewritten in either file beyond the dropped turn: a text that no model is handed is the owner's history.

**The one rebuild.** Not the whole index: only the entries that hold a learned text are made again, each from its run's file, and an entry whose file is gone loses that text. It runs at start, before a run, a Chief turn or a request is served, so recall never answers from a half-made index and needs no answer for "meanwhile". Its cost is one file read and one entry per run that learned something, a small part of the 70 seconds per 10,000 runs a whole rebuild takes. `index_version` records it, and a second start makes nothing again.

**An interrupted erase.** The erase writes down the ids it names (`erasing`) and then does everything in one transaction, which also takes that entry away: either all of it is in the database or none. A stop in between leaves the entry, and the store completes the erase when it is next opened, before anything reads. The mark in each run's own file is written after the transaction; the start writes it where it is missing. `leftOut` answers from the database first, so a run is left out from the moment the transaction is committed, whatever its file says.

**The 30 days count from the removal.** A removed note is purged 30 days after it was removed, whatever its age. The same holds for the text a note had before a change: an earlier version is purged 30 days after it stopped being true. The purge runs at start and once a day, with the clock as an argument.

**A note's end.** `until` is a calendar day, the last day the note holds; a past day is refused. "Today" is the day in the time zone of the botdot server, which schedules follow. From the day after, the note is removed with the reason "ended" by botdot: the store checks before it hands out notes (a prompt's pinned notes, the lookup, recall, the lists) and at start, so a day on which botdot was not running changes nothing. Brought back after its day, the note has no end.

**Routine choices made with it.**

- A forget waits in every run that is not the owner's own clean run, a job's run and the review included: none is refused, and none erases. The review's instructions tell it to remove and never to forget.
- A removed note is listed and restored by a bot in a run the owner started, whatever that run has read: bringing back restores a text that was there. The Chief's tools are handed no removed note; the owner's own search still finds them.
- Recall with `history: true` hands a bot the earlier texts of notes that exist, and no removed note.
- A waiting forget holds ids and no text; its card is handed the notes as they stand, so that nothing is approved unseen.
- An addition that waits has no note and so no id. A forget takes one with it when it would save a text an erased note had (the duplicate key of [ADR 015](015-the-server-records-who-said-a-note.md)) to the notes that note was in or to the shared ones, and leaves out the runs that asked for it. Its answer names a change that still waits and holds the words, another bot's without its text: no forget reaches that one, the owner declines its card (MEM-011).
- An approved forget writes two lines to the audit log, the approval and the forget.
- A `learned` item from before this decision keeps its text in its run's file. An app is sent it as it was written; no model is.
- A run of a bot that was deleted is not indexed, at the end of the run or at a later start.
- A forgotten note's id is never given to another note.
- A Chief reply can be left out by the owner's mark only: the Chief has no forget until [ADR 017](017-the-chief-files-a-note-with-a-bot-in-the-owners-turns.md) is built (MEM-006).

## Alternatives

- **Erase run files, logs and transcripts too.** Offered to the owner and not chosen: those chats would leave the owner's own history.
- **Keep removed notes for ever,** as today. Offered and not chosen.
- **A ban list of forgotten facts.** It would have to keep the text it promises to erase.
- **No end date; real dates in the note's text only** (the audit's advice). The note would stay pinned after its dates passed. The owner asked for passing states to be kept and to stop applying.
- **A decay score.** Nothing in the product can set one.

## Consequences

- **Supersedes the name `forget` for removing a note** (the bots' tools since their memory moved to `memory.db`). A bot that reads an older skill or note telling it to "forget" a stale note now asks to erase it: in its own clean run that erases for good, anywhere else it waits on a card.
- **History is 30 days.** "What was it before?" is answered for 30 days after a change; before this decision, for ever. README said "Deleted notes are kept too" and no longer does.
- **A deleted bot's chats leave the owner's search** (`GET /api/search`) with its indexed runs; its run files stay in the run history. Before, they stayed searchable.
- **A forget leaves out more than the note's own runs:** the asking run too, so the bot's next message finds no trace of the request in its chat block. The owner still sees it.
- **What a forget does not reach:** run files, logs, screenshots and Claude's transcripts (by the owner's decision); a Chief reply that quoted the forgotten thing, and another bot's run that held it, which are in neither `still` nor the bot's reach until the Chief can forget (MEM-006); a resumed Chief session that was already told a result; an old `learned` text in a run file from before this decision.
- **An erase cannot be undone.** A wrong match erases too much. The brakes are the gate (the owner's own clean run, or a card), the bot naming ids it found with recall, and the answer's `still`. What a bot passes to the tool is model behaviour.
- **A chip is no longer a stored sentence.** It is put together when a run is read, so the chip under an old reply follows its note: a changed text, "since removed", "since forgotten". An app from Milestone 8, which builds the line from `kind` and `text`, is sent a `text` put together the same way.
- **An app from Milestone 8 is shown no forget that waits**, as for every guarded change ([ADR 015](015-the-server-records-who-said-a-note.md)): its bot's face says that it needs the owner until a newer app shows the card.
- **A column and a table are added in the one place** ADR 015 named: `COLUMNS` and `SCHEMA_VERSION` in `lib/memory.js`.
