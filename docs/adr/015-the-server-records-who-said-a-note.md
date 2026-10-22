# ADR-015: The server records who said a note

- **Status:** Accepted
- **Owning task:** MEM-003

## Context

[Milestone 9](../product/milestone9.md). A note keeps `by`, the last writer: the owner where they typed it in an app, otherwise the bot. What the owner dictated to a bot in chat and what the bot concluded by itself look the same, to the store and to the model, and a pinned line carries no date. Three findings of [the memory audit](../product/improvements/2026-10-06-memory-audit.md) rest on that:

- A full pinned set unpins by last use, so the oldest thing the owner said in chat leaves the prompt first, silently (finding 2).
- Two notes that contradict each other stand side by side, and the prompt's own rule "newer ones win" cannot be applied (finding 3).
- A note saved after a bot read a web page is pinned like any other, any bot may rewrite a shared note of the owner's, and only a shared change after outside content waits for the owner (finding 6).

A run has no positive mark for "the owner started this": only `sender()` in `lib/chat-history.js` derives it, for the conversation block. A run that carries on after an OK ([ADR 009](009-the-botdot-server-carries-on-after-an-ok.md)) starts with its outside mark off, though the run it continues may have read the web.

The schema is `CREATE TABLE IF NOT EXISTS`; no column was ever added to a table that exists.

On 2026-10-06 the owner decided: a note saved after outside content is not "you said", also in a run they started; the weekly review and a scheduled run leave what the owner said alone; a skill written after the bot read the web waits for their OK, after its own commands alone it does not.

OpenClaw sets a note's origin in code from a closed set and never defaults it to the owner ([research note](../archive/product/milestone9-research.md), section 2).

## Decision

- **Every note has a source: the owner, the bot, or outside.** The botdot server sets it when the note is saved. No model sets it and it is never read out of a note's text. Versions and waiting changes keep it.
- **The owner:** saved in a run the owner started, before that run read outside content; or typed by the owner; or filed by the Chief in a turn the owner started ([ADR 017](017-the-chief-files-a-note-with-a-bot-in-the-owners-turns.md)). **Outside:** saved after the run read outside content. **The bot:** everything else, which includes a job's run, a run a teammate or the Chief started, and the review. What cannot be told is never the owner.
- **"A run the owner started" is one function of the server** over what a run already records. A carry-on and a follow-up answer as the run they continue, and keep what that run had read.
- **The outside mark says what was read:** the bot's own commands only, or content from others (the web, a connected app, the bot's computer, a file or message from someone else). Any of it makes a note "outside". Only content from others makes a new skill wait for the owner. (Superseded by [ADR 050](050-a-bot-saves-a-skill-it-wrote-without-an-ok.md): a bot's skill is saved at once in every run.)
- **Only the bot's and outside notes are unpinned automatically,** outside ones first, then the oldest. A note of the owner's never is. When the pinned set holds only the owner's, a new note is kept searchable. Every unpin is in the tool's answer.
- **A note of the owner's is changed or removed** in a run the owner started, before outside content. The review and a job's run are refused. Any other run waits for the owner on a card. (Changed by [ADR 059](059-a-note-is-saved-without-an-ok.md): a change is saved at once in such a run and the note is no longer the owner's; only a removal waits.)
- **Every printed line carries its source and date,** and every prompt the rule that reads them: the owner's current message, then the bot's own notes, then shared notes, then past runs; the owner's word beats the bot's conclusion; among equals the newer date wins.
- **Notes from before:** the owner where the owner typed it; otherwise by the run that saved it, where that run's file still exists; otherwise the bot.
- **A column is added in one place.** At start botdot compares the tables with what it needs and adds what is missing, once, and records the schema's version.

### Resolved by MEM-003

**Names.**

- The column is `source`, on `notes`, `note_versions` and `pending`, with the values `owner`, `bot` and `outside`. A waiting change that touches what the owner said has `guarded` in `pending`. `lib/memory.js` lists what a table needs beyond what it was first made with (`COLUMNS`) and adds what is missing at start; `meta` keeps `schema_version` (now `2`) and `sources_at`, the moment the notes from before got their source.
- A note, an earlier version and a waiting change are handed out with `source`. A bot's memory tool is answered `result` (`saved`, `already`, `waits`, `refused`), `say`, and where they apply `note`, `unpinned` and `similar`. A `learned` item has `chip`. A waiting change has `title`, `meta`, `yes` and `no`, its answer `text`, and a guarded one `guarded: true`, listed for `guarded=1`. `features` announces `memory-chips` and `memory-cards`. All of it is in `docs/api.md`, Memory, "The contract".
- A run's record keeps `outside`, the kinds of outside content it has read (`commands`, `web`, `app`, `computer`, `file`, `teammate`; `unknown` for a record from before the kinds), and `follows`, the run whose task it finishes once teammates have answered.

**The words of each source.** In a line a bot reads: `the owner said`, `a bot's conclusion`, `after outside content`, as `- [id] (topic, the owner said, 2026-09-12) text`. The brackets end with botdot's two parts; a topic is a bot's text and loses its brackets and commas there. On a chip: nothing for the owner's (the chip stands under their own message), `, its own conclusion`, `, after outside content`. One function prints the line (`noteLine` in `lib/prompt-text.js`) and one file holds the words of chips, cards and answers (`lib/learning.js`).

**The pin lock stays.** The source says who said a note; the pin lock says that the owner pinned it by hand. A bot's conclusion the owner pinned is locked and not the owner's word. Neither kind is unpinned to make room, and a bot unpins neither by itself.

**How the server knows what a run has read.** The run's record, held in memory while the run goes, is marked as botdot reads from Claude Code's output that the run asks for a tool: before the tool's result exists, so nothing a result could have shaped is saved without the mark. A script's output handed to the AI, a teammate's message and a teammate's note are marked from the start. A carry-on starts with all that the run it continues had read, and so does a run that follows one. A save asks that record (`runStanding` in `lib/bots.js`) and nothing in the request; a run the server cannot place counts as having read everything.

**"A run the owner started"** is `whoStarted` in `lib/chat-history.js`, over the fields a run records: the owner (a message, a tile of the Board), the Chief, a teammate, a job (at its time, "Run now", a script's hand-over), the review, or nobody it can tell. `sender()` uses it, so a run of a kind it does not know is no longer "the owner" in the conversation block either.

**The same sentence from two sources.** The duplicate key is the topic and the text, lower-cased in any language, without the spacing and the punctuation at the end; it is computed, not stored. A second save of the same key makes no note and no chip. When the owner says it, the note becomes the owner's and carries that day, whoever saved it first. When anyone else says it, nothing changes: what the owner said is not taken back by a page. The key is per owner of the notes: the same sentence in a bot's notes and in the shared ones is two notes, and the hint names the other.

**Routine choices made with it.**

- "Oldest" is the day a note last changed. How often recall returned a note no longer protects it.
- A teammate's message is outside content, so a note saved in a run a teammate started is `outside` from its start, never `bot`.
- Reading a file (`Read`, `Grep`) makes a note `outside`: botdot cannot tell whose text a file holds. A file the owner sent with a message counts from the moment the run reads it, so a note saved first is the owner's. A file read makes no skill wait and no shared change wait.
- The card for a shared change waits exactly when it did before this decision, plus in a run that carries on from one where it did: reading a file or a teammate's note alone asks the owner nothing.
- A bot that rewrites a note saved after outside content leaves it `outside`; only the owner's word lifts it. A version that is brought back comes back as whoever said it then.
- The owner's yes to a guarded change leaves the note the owner's: they read the new text and approved it. Their yes to any other waiting change saves it as whoever asked would have: an approved addition after a web page is still `outside`.
- A bot may not unpin what the owner said except where it may change it. In every other run that is refused, with no card.
- A waiting change is guarded for as long as its note is the owner's, whenever the note became so: a change to a bot's shared note that waits when the owner says that sentence is guarded from then on, and no longer listed for an app from Milestone 8.
- A skill that waits is an ask of kind `skill` with no link, one card per bot and name. Its card is handed the whole text a yes would save: nothing is approved unseen.
- What the Chief's tools file is `bot` until [ADR 017](017-the-chief-files-a-note-with-a-bot-in-the-owners-turns.md) is built (MEM-006).

## Alternatives

- **The model says who said it.** One obeyed sentence from a web page would then write "the owner".
- **Confidence or importance numbers.** A model would be guessing them; the source is the one such fact botdot knows for certain.
- **An outside note is never pinned and never in the lookup** (OpenClaw). Commands set the outside mark, so most of what a working bot learns would never reach its prompt.
- **A card for every change to a note of the owner's,** also by the review. Offered to the owner and not chosen: more cards.

## Consequences

- **Adds to [ADR 009](009-the-botdot-server-carries-on-after-an-ok.md):** a run that carries on starts with what the stopped run had read, and answers "who started it" as that run. Before, it started as a run that had read nothing. No decision of ADR 009 changes.
- **A coding bot's notes are mostly `outside`.** Commands set the mark, so in such a run a note is the owner's only when it is saved first. That the bot does so rests on one sentence of its instructions; MEM-004's live run shows whether it holds.
- **Notes from before** got their source from a run's file. Where the file is gone, what the owner dictated long ago reads as the bot's own and can be unpinned.
- **What the mark does not see.** A reply of an earlier run that quoted a web page reaches a later run through its chat, recall or the lookup, and a note saved from it there is not `outside`. The review, which reads many such replies, still has every shared change wait; a skill it writes goes in as before, since it read no content from others in its own run.
- **Last use no longer decides what leaves the pinned set.** A bot's often-recalled old conclusion goes before a newer one. The owner's word, the thing the audit found leaving first, never goes.
- **A full pinned set of the owner's notes** takes no more: the thirty-first is searchable and the bot says so. Which note goes is the owner's to say, by chat.
- **An app from Milestone 8** is listed no guarded change, in `GET /api/memory/pending`, in the count of `GET /api/memory` and in the feed, so its "Approve all" cannot take one. Until the owner opens a newer app such a change is invisible, while its bot's face says that it needs them.
- **More refusals a bot has to relay.** The tools answer with the sentence to pass on; whether a bot passes it on is model behaviour.
- **A column is added in one place** from now on: a later task adds a line to `COLUMNS` and raises `SCHEMA_VERSION`.
