# ADR-139: A group keeps notes of what was settled in its chat

- **Status:** Accepted (asked for by the owner, 2026-11-02)
- **Owning task:** [#893](https://github.com/Kordal/bot-dot/issues/893)
- **Changes:** [ADR 020](020-a-member-reads-the-groups-chat-and-keeps-its-own-memory.md) (what a turn reads of its group)

## Context

A turn in a group or a team's chat reads only the newest part of the group's chat (`lib/chat-history.js groupChat`): 30 lines at most, from the last 7 days, 40,000 characters in all, each text cut to 1,500. Older lines drop out with no summary. A group has no memory of its own: each member keeps only what it chose to write to its own notes or to shared memory, and a member cannot read another member's runs. So a decision made two weeks ago, or 31 lines back, is lost to every member that did not save it, and a bot that joins a team later knows none of it.

## Decision

- **Each group, a team's chat among them, has one list of notes** (`lib/group-notes.js`), kept in `<data>/group-notes/<id>.json` beside its messages and deleted with the group. An item is a kind, `decision`, `open` (what someone still owes, with who) or `fact`, and one line of at most 240 characters. It also records who wrote it (`owner`, `bot` with the bot's id, or `botdot`), when, and, for one botdot wrote, the message or run it came from.
- **Every member's turn reads the notes, above the group's chat**, as records with who wrote each. Only a note by the owner holds the owner's words. The others are information, the same as a teammate's reply, and never the owner's instructions or OK. Each text goes through `inert`.
- **botdot folds the chat into the notes when a message's line ends.** The lines since the last fold, at most the newest 40, and the notes as they stand go to Claude Haiku (`claude-haiku-5-5`). It is asked as the group router asks (`lib/dresser.js askClaude`): a system prompt of its own, no tools, no session kept, on the Claude sign-in the bots already use. It answers one line of JSON, `{"keep":[<numbers>],"add":[{kind,text,line}]}`. Notes it does not keep are done. The answer is never trusted: no JSON, a number that is no note, a kind that is no kind, or an empty text changes nothing. One fold runs at a time per group, and a line that ends meanwhile is read by the next fold. Nothing is folded while Claude is signed out. `through`, the time of the newest line read, moves only when a fold is used.
- **The owner's notes are theirs.** A note the owner wrote or changed on the screen is never changed or dropped by a fold or by the cap. A member removes one only in a turn the owner's own message gave, which is how the owner says "forget that" by chat.
- **Members keep notes too:** `group_note` (lib/self-mcp.js), only in a group's turn, adds a note or removes one by its id.
- **At most 2,000 characters of text in all.** Past that, the oldest notes not by the owner go first. A note of the owner's that would not fit is refused with "The notes are full: remove one first."
- **In a team's chat the project's decisions log (#694) stays the record of the owner's decisions:** the fold is handed it and told never to add one of them again.
- **The owner sees and changes them in the group's panel, on the web and on Android** (`GET/POST /api/group-chats/:id/notes`, `PUT/DELETE /api/group-chats/:id/notes/:noteId`). The panel lists decisions, then to do, then facts. A note's kind and line change where they stand, ✕ removes a note, and the last row adds one. The Chief's key is refused there. A change is said on the feed as `group_notes`.
- **`BOT_DOT_GROUP_NOTES=off` stops the folds** (the tests). The notes, `group_note` and the panel stay.

## Alternatives

- **A rolling summary in free text.** Rejected: rewritten again and again, it drifts and loses the specifics, nothing in it can be traced to a line, and the owner cannot correct one point without rewriting the whole.
- **A bigger window of the chat.** Rejected: it costs tokens on every turn of every member and still ends somewhere.
- **Fold only when lines are about to leave the window.** Rejected: a chat that goes quiet for a week loses its lines by age with no line ending to fold them, and the notes would lag behind what the panel should show. One small call per ended line is cheap, and it keeps the notes current.
- **Jev for the fold.** Not possible: Jev answers typed questions with probabilities (ADR 082) and writes no text.
- **Index the notes for `recall`.** Left out: every turn of the group already reads them whole, and the group's runs are in each member's recall.

## Consequences

- What was settled outlives the window: a decision 31 lines or 8 days back is in every member's next turn, and a member that joins later reads it.
- Each ended line costs one small model call, counted with the Chief's tokens. A fold that fails costs a line that is read again next time, not a lost one.
- A wrong note is visible and fixable by the owner in the panel, and a fold never touches a note once the owner has.
