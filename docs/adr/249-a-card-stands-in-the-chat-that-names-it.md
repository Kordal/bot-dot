# ADR-249: A card stands in the chat that names it

- **Status:** Accepted
- **Owning task:** the owner's request of 15 November 2026: a project's page did not show what waited for their OK, and a bot that said "in Needs you a card waits" only pointed elsewhere
- **Changes:** [ADR 245](245-the-project-overview-is-the-board.md) (Needs you is one of the board's tiles), in the line of [ADR 168](168-a-missing-app-is-one-connect-card-and-connecting-it-carries-the-work-on.md) (cards in the chat, not only in Needs you) and [ADR 228](228-a-bot-withdraws-a-card-it-no-longer-needs.md) (a card's id in the prompt)

## Context

A card stood at the end of the chat it was asked in, and on the Needs you page. A lead, the Project Manager or the Chief that told the owner "Website Builder's card 'Needs Stripe reconnected' waits in Needs you" only pointed there: the owner left the chat to find it. On a project's page Needs you was a tile the board could hide, and it listed a bot's asks only on the first project the bot was in.

## Decision

- **A message names a card by its id.** Every prompt that lists cards in Needs you already names each `[card <id>]` (ADR 228). Bots, leads, the Project Manager and now the Chief (a line in each turn with what waits, at most ten) are told to put that id right after the card when they tell the owner it waits.
- **botdot takes the ids off the text** (`lib/card-refs.js`): an eight-hex-digit id in `[card …]` or `[[card: …]]`, at most four, each once. They are kept as `cards` on the run (a bot's reply in its chat or a group) and on the Chief chat message (a Chief reply, a bot's report). The text the owner reads, a push and a copy have no ids.
- **The apps draw each card that still waits under the message that names it**, the same card as in Needs you with its buttons, and not again at the end of the chat. A card answered there stays faded under the message; one that waits no more draws nothing. A card named by several messages stands under the newest.
- **Needs you on a project's page is never hidden.** When something waits it shows first, above the arranged tiles; it is no piece to add or hide. A project lists the asks of every bot of its teams and its own bots, also of a bot that is in another project too.

## Alternatives

- **Move the card into the chat that talks about it** (re-home its `chatId`): a card would leave the bot's own chat where it was asked, and one message could not show a card of another chat.
- **Parse the card's title out of the text**: titles repeat and change with the language; the id is exact.
- **Feature flag**: an older app ignores `cards`, and the text is clean for it too.

## Consequences

- A bot that names a card it was not told of draws nothing: only ids of cards that wait are drawn.
- The server refuses to hide `needs` (`PUT /api/company/layout`, the Chief's and a bot's `arrange_project_board`); a `board` saved before without it is ignored by every app, and none offers it to add or hide.
- The Chief is told of the asks that wait, not of login and card payment requests: those are named by the bot that asked, whose prompt lists them.
- `cards` is new on runs and Chief messages (docs/api.md, "A card in the chat").
