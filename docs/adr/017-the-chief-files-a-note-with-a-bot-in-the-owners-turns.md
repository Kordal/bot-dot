# ADR-017: The Chief files a note with a bot, in the owner's turns only

- **Status:** Accepted; its chip decisions superseded by [ADR 024](024-a-done-memory-change-is-no-row-under-a-reply.md) (2026-10-13)
- **Owning task:** MEM-006

## Context

[Milestone 9](../product/milestone9.md). The Chief of Staff has no notes of its own and one place to write: the shared notes, which are in every bot's prompt (`lib/mcp-server.js`, `remember_shared`). It reads every bot's notes through `recall` and can write, list or delete none. So "we decided to use PostgreSQL for this project" becomes a line in the weather bot's prompt, or lives in one chat's session ([the memory audit](../product/improvements/2026-10-06-memory-audit.md), finding 8).

Its shared writes have no gate. A Chief turn does not record who started it: the owner's message, a late result with a bot's reply quoted in it, an answered card and a tool request all get the same 44 tools (`lib/chief.js`). The Chief reads every bot's output, and a bot's output may repeat a web page.

With Milestone 9 the apps show no memory screen, so the Chief is also where the owner asks what a bot holds.

On 2026-10-06 the owner decided: the Chief may write a bot's notes directly, in a turn they started and in no other; a work preference that fits several bots is filed with each of them, not as one shared note.

No product surveyed documents an orchestrator that writes into another agent's memory; the documented shape is one shared read-only store and one private store per agent ([research note](../archive/product/milestone9-research.md), section 5).

## Decision

- **The Chief has notes of its own,** in its prompt as a bot's are in the bot's: how the owner wants the team run and how the Chief should work with them.
- **It files a note in one of three places:** for everyone (about the owner as a person), for itself, or with named bots. A note filed with a bot is in that bot's next prompt; the bot is sent nothing.
- **It can list, correct, remove, restore and forget a bot's notes.**
- **A Chief turn records who started it:** the owner, by their message, or botdot (a late result, an answered card, a tool request, a look).
- **Only a turn the owner started can write memory.** In a turn botdot started the tools that write memory are not given, and the routes behind them refuse.
- **In the owner's turn, what the Chief read counts.** After it read a bot's reply or the web in that turn, what it saves is not "the owner" ([ADR 015](015-the-server-records-who-said-a-note.md)), and a forget or a change to a note of the owner's waits on a card ([ADR 016](016-a-forgotten-note-is-erased-and-a-removed-one-ends.md)).
- **The chip names the place,** from the store's answer: "Remembered for Coder and Reviewer". A duplicate makes none. (Superseded by [ADR 024](024-a-done-memory-change-is-no-row-under-a-reply.md) for a change that is done: no app is sent its chip; the chat keeps it.)
- **Before a turn the Chief is given the lookup** over its own notes and chats, as a bot is.

### Resolved by MEM-006

**Names.**

- The Chief's own notes have the owner `chief` in `memory.db`, beside a bot's id and `_shared` (`lib/chief-tools.js`, `CHIEF_NOTES`). A bot's id is eight hex characters, so none collides with it. No table and no column was added: `schema_version` stays `4`.
- The Chief's tools: `remember` files a note (`place`: `everyone`, `bots` with their names or ids, or `me`), `list_notes` lists one place's notes in pages, `update_note` corrects, `remove_note` removes, `restore_note` brings a removed note back, `forget` erases. They are a bot's verbs under a bot's names, so "remove" and "forget" mean one thing each in the whole product ([ADR 016](016-a-forgotten-note-is-erased-and-a-removed-one-ends.md)). **The old three are gone:** `remember_shared`, `update_shared` and `forget_shared`, the last of which removed and did not erase.
- The routes are `GET` and `POST /api/chief/memory`, the Chief's alone. `POST /api/memory/shared`, through which the Chief changed and removed a note of the owner's unguarded and made it a bot's, is the owner's alone again.
- A Chief message has `startedBy` (`owner` or `botdot`), `read` (the kinds of text that are not the owner's which its turn has read) and `relevant` (what the lookup handed it). The tools' server is told whose turn it is in `BOT_DOT_TURN`. All of it is in `docs/api.md`, "The Chief's memory".

**Whose turn, and where it is enforced.** A turn is the owner's when their message starts it, also one that waited behind a reply and the tap on "Approve" under a bot's plan; every other turn is botdot's. Two places hold the rule, by the same fact. The tools' server offers the five writing tools only when it is told the turn is the owner's, and offers none when it is told nothing. The route asks the Chief which turn is going in the chat the call names, and refuses unless that turn is the owner's: a call from a look, which has no chat, from a chat where no reply is going, and from a turn botdot started are all refused. "Memory" here is notes. The memory review and the memory settings stay with every turn: a review cannot touch what the owner said ([ADR 015](015-the-server-records-who-said-a-note.md)).

**What a turn has read.** A kind is recorded when the turn asks for a tool, before the tool's answer exists, as for a bot's run. `lib/chief-tools.js` says for every tool whether its answer always holds text that is not the owner's: a bot's run or reply (`bot`), the Board, a registry, a catalogue or a link (`web`), a file (`file`). A tool that neither list names counts as read (`unknown`), so a new tool is clean only when someone says so, and a test fails while a tool of the Chief is in neither list. For two tools the server decides by what it hands over: `recall` and `list_notes` mark the turn when the answer holds a past run or a note that is not the owner's own word. Notes the owner said can be listed and searched without a mark, or no note of the owner's could ever be corrected or forgotten at once: the Chief has to find its id first. A forget's answer marks the turn the same way when what still matches holds a note that is not the owner's, or what a run was asked that the owner did not start: the Chief is told to forget again with it, and that second forget then waits. Not read: the list of the bots with their settings (`list_bots`; one bot in full, `get_bot`, holds the question of its last reply and counts), the Chief's own skills, and, as for a bot ([ADR 015](015-the-server-records-who-said-a-note.md), "What the mark does not see"), what botdot puts into the prompt itself: the pinned notes and the lookup's items, which can hold a bot's conclusion or an earlier reply of the Chief's that reported one.

**An unasked message of a look counts as read.** A look reads the bots' runs and searches the web, and its message is quoted into the owner's next turn in that chat as the Chief's own words. A sentence a web page planted in it would otherwise be saved as the owner's. So that one turn starts with `look` among what it has read; the turn after it does not. A bot's result that stood unread in the chat and a bot's plan that waits there mark the turn the same way (`bot`). So does a reminder that went off (`reminder`, since MEM-011): `remind_me` is given to every turn, so a turn botdot started with a bot's reply in it can set the words that are later quoted into the owner's turn.

**The source of what the Chief files** is `owner` before the turn read anything, and `outside` after: a bot's reply is outside content to the Chief, as a teammate's message is to a bot. It is never `bot`: a turn that could only conclude writes nothing.

**What waits, and what does not.** A forget, and a change or removal of a note of the owner's, wait as a guarded change once the turn has read something; the card says "after reading outside content" and is the Chief's. Filing never waits, also for everyone: the owner chose that over a card for every note. Here the Chief differs from a bot, whose shared note after outside content waits. A note that is not the owner's is changed and removed at once.

**A bot whose learning is off is filed with too.** "Off" means that the bot saves nothing by itself; it still reads its pinned notes. A note the owner dictated to the Chief for it arrives in its next prompt.

**A bot that is not there.** The Chief names bots by the names the owner uses, or by id, and the server resolves them, so that the Chief need not look the team up before it saves. A name no bot has, or that several have, saves nothing for that name; the answer says so, and the others are saved.

**The Chief's forget** names notes wherever they are (for everyone, its own, a bot's, removed ones too) and runs of any bot and replies of its own. The reply that asks is left out with them, as the run that asks is for a bot. Its answer searches all notes and all runs for what still matches. Runs alone can be named: that is how one chat is left out by hand, now that no app has a control for it. A note the Chief files keeps the reply that filed it among the runs that wrote it, so a later forget of the note, by anyone, leaves that reply out. A reply of the Chief's that a forget leaves out carries the mark on its message in its chat (`forgotten`), as a run does in its file.

**The chip is a stored line.** The server writes it from the store's answer, and the reply keeps it as the action's text, with the ids of its notes. This differs from a bot's run, whose record keeps no text ([ADR 016](016-a-forgotten-note-is-erased-and-a-removed-one-ends.md)): the Chief's chips were stored lines before, and an app from Milestone 8 prints such a line as it is. No model is handed it: the index keeps "Changed a note in memory" in its place. (Superseded by [ADR 024](024-a-done-memory-change-is-no-row-under-a-reply.md) for what an app is sent: the chip of a change that is done stays in the chat and is left out of what an app reads.)

**The lookup** is `relevantFor` with the Chief as the bot: its own notes and the shared notes that are not pinned, and its earlier replies. It is asked for when the turn starts and awaited while Claude Code starts, and stands in the turn's message, not in the system prompt, which a resumed session ignores. Replies of the chat it resumes are left out of it: the session has them.

**The shared notes are sent with every turn, as before.** Tested once by hand on 2026-10-07, Claude Code 2.1.292, `claude-sonnet-5-5`: a session was sent 30 notes once, in its first message, then a bot's log of 215,000 characters, and was compacted with `/compact` (89,665 tokens before, 2,931 after). Asked about six of the notes, a copy of the session from before the compaction answered six of six; the compacted session answered none, and said that the conversation held nothing of the kind. A note sent once does not survive a compaction. The Chief's own pinned notes are sent with every turn for the same reason.

**Routine choices made with it.**

- The Chief may restore a removed note in any turn the owner started, whatever that turn has read, as a bot may.
- A removed note is listed for the Chief only in a turn the owner started. This replaces "The Chief's tools are handed no removed note" of [ADR 016](016-a-forgotten-note-is-erased-and-a-removed-one-ends.md); `GET /api/memory` and the Chief's recall still hand it none.
- The same sentence filed again makes no second note and no chip; filed by the owner's word, the note becomes the owner's, as for a bot.
- A note the Chief files is pinned and not pin-locked: the lock says that the owner pinned it by hand.
- The look is handed the Chief's own pinned notes beside the shared ones: what the owner wants from unasked messages is now a note of the Chief's.
- A message that comes in above a reply while it is written (a bot's file) moves the reply's place in its chat, and so its id in the index. What memory recorded under the first id follows it to the last (`renameRun` in `lib/memory.js`).

## Alternatives

- **Every note the Chief files with a bot waits on a card.** Offered to the owner and not chosen.
- **The Chief sends the bot a message and the bot saves it.** A run of the bot for every note, and the note would be the bot's, not the owner's.
- **One shared note for a work preference.** Offered and not chosen: it is in every bot's prompt.
- **The Chief keeps writing for everyone only.** A project decision would have no home.

## Consequences

- **Supersedes, in [ADR 015](015-the-server-records-who-said-a-note.md):** "What the Chief's tools file is `bot` until ADR 017 is built". It is `owner` or `outside` now, and the Chief no longer reaches `POST /api/memory/shared`.
- **Supersedes, in [ADR 016](016-a-forgotten-note-is-erased-and-a-removed-one-ends.md):** "The Chief's tools are handed no removed note" (above), "A Chief reply can be left out by the owner's mark only", and of what a forget does not reach, "a Chief reply that quoted the forgotten thing, and another bot's run that held it": the Chief's forget names both.
- **The Chief has to save first.** In a turn where it looked at a bot's run, read a file or recalled a past chat before it saved, the note is "after outside content", is unpinned before a bot's own conclusions when a pinned set is full, and can be changed by any bot. That it saves first rests on a sentence of its instructions; the milestone's live run shows whether it holds.
- **An answer to a look's message is never the owner's word.** "Yes, and remember that I like those" is saved as outside content in that one turn. The owner says it again in a later message for it to count.
- **A turn botdot started cannot save what it learned.** The Chief says what it would save, and the owner tells it to.
- **A note filed with the wrong bot** is seen on the chip only, and corrected by chat. (Superseded by [ADR 024](024-a-done-memory-change-is-no-row-under-a-reply.md): there is no chip; it is seen in the Chief's reply, which names where it filed the note.) A bot created later is filed nothing that was filed with each bot it fitted before.
- **A chat's turns cost more tokens than a single telling would:** the pinned shared notes and the Chief's own, up to 5,000 characters each, go with every turn.
- **Old chips stay searchable.** A reply from before this decision keeps "Remembered for all bots: …" in the index of what it did. The Chief's forget finds such a reply by its words and names it in what still matches; nothing is rebuilt.
- **An older resumed session** is told the new instructions once, with its next turn, and finds the old three tools gone.
- **What the mark does not see,** as for a bot ([ADR 015](015-the-server-records-who-said-a-note.md)): a session that is resumed still holds what earlier turns read. Only this turn's reading is counted.
