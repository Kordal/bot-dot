# ADR-273: A message to the project's manager may point at a tile of its board

- **Status:** Accepted. Builds on [ADR 245](245-the-project-overview-is-the-board.md) (the overview is the board), [ADR 230](230-the-project-manager-is-the-bot-the-owner-picked-and-the-projects-chat-is-the-chiefs.md) (the project's manager bot) and [ADR 252](252-a-card-stands-in-the-chat-that-names-it.md) (a card stands in the chat that names it).
- **Owning task:** the pencil on a board tile (the design is the approved mockup of variant A, the always-visible pencil).
- **Builds on:** `lib/project-board-note.js` (the board as the manager is told it), `lib/project-manager.js`, `arrange_project_board` and `change_project_card`, `public/bot-chat.js`' Reply chip.

## Context

The owner asks the project's manager to change the board in words: "show only the Bookkeeper's replies", "make the decisions card newest first". Which tile is meant is the part words carry badly: two tiles may look alike, a card's title is not its id, and the manager can answer about the wrong one or ask back. The board is the one page of a project (ADR 245), and the owner is looking at the tile when they think of the change.

## Decision

- **A pencil on each tile that has a title of its own**: Current work, Blockers, Latest replies, Calendar, To-do, Files and a card made by Claude, in the tile's head right of the title (a small round button, always visible). A goal has its own Change pencil already and a team's room has its own chat, so neither gets this one; `days` and `needs` have no title to point at.
- **It points the project's own chat at the tile.** Pressing it opens the project's own chat (the manager bot's, else the project's own Chief chat, as the apps already choose), puts a chip naming the tile above the message box, focuses the box and rings the tile. The chip's × sends a plain message; sending clears the chip and the ring.
- **The message carries the tile.** `POST /api/bots/:id/run` and `POST /api/chief/chats/:id/messages` take `card`, a tile id as `arrange_project_board` names it (`replies`, `card:<id>`), and `project`. The server checks it against the project's board *now* (`pointedAt`): an unknown tile, a non-project chat or an ambiguous bot is `400`, so a stale chip never reaches the manager as a guess.
- **The turn is told which tile and what it shows.** The note reuses the board note's rows and its untrusted-text handling, in the owner's approved wording: a fixed tile may be moved, resized or hidden with `arrange_project_board` but not changed in what it lists, and the manager says so if asked; a built card is changed with `change_project_card`. No new ability: the manager has the same tools as before and knows which tile.
- **The record keeps it**, `card: { id, label }`, on the run and on a Chief chat's message, and a bubble shows the label small above the text, as a Reply shows what it replies to.
- **Such a message is never sorted into another run or steered into a running one**: it is about one tile, and the note must reach a turn of its own. It waits its turn like any message.
- **`card-edit` in `features`.** An app draws the pencil only when the server has it and the project is running and has a chat to open. The web page and the Android app ship it together; iOS catches up in [#1355](https://github.com/ladrok/bot-dot/issues/1355).

## Alternatives

- **Describe the tile in the message by hand.** What the owner does today; it is the ambiguity this removes.
- **Edit the tile in place** (a form on each tile). Each fixed tile would need its own editor, and the manager already changes the board; pointing adds no new ability, only the missing "this one".
- **Let the client send the tile's rows.** The client would then tell the manager what a tile shows; the server knows it, so it tells it, and the client sends only the id.
- **A pencil on goals too.** They have Change, which starts a chat about the goal; a second pencil on the same tile would do two things.

## Consequences

- A tile gone from the board while the chip stands is refused with `400`; the web page also drops the chip when the board is drawn again without the tile.
- A waiting message that is steered by hand (Steer) drops the tile line: the steer hands the words to a run at work without a turn of their own.
- Android shows the tile's label on stored runs, Chief messages and waiting messages; the on-its-way bubble (before the server answers) has none.
- The note is composed per turn from the board as it is then, so it cannot go stale.
