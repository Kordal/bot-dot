# ADR-184: An action that reaches no one can be always allowed for every bot

- **Status:** Accepted (2026-11-10, the owner's go on "less heavy, less minding the bots")
- **Changes:** ADR 010 and #474: "Always allow" on a connected app's action was for the bot that asked only
- **Keeps:** ADR 055 (the Chief's types and a bot's lifted rules stay per bot or per type); the Chief's own grants (ADR 047); every payment and Vault card

## Context

The owner allowed the same action again for every bot: a label in Gmail, an event in the calendar, a page in Notion. Each new bot asked again. Owners felt they had to mind their bots.

## Decision

- **Who.** "Always allow" on a bot's card of an action in a connected app asks whom: only that bot, or all bots, the ones there are and the ones made later. `POST /api/asks/:id` takes `{ yes: true, always: "all" }`. The grant is kept under `all` in `connector-actions.json`, beside each bot's own.
- **Which actions.** Only one whose name says it reaches no one, removes nothing and pays nothing: no send, post, reply, forward, publish, tweet, invite, share, comment, message, delete, remove, trash, pay, transfer, charge or refund (`lib/asks.js` `forEveryBot`). Those stay per bot: the owner trusts one bot to write to people for them, not every bot they will make. The server refuses `all` on any other card.
- **Not the Chief's.** A grant for every bot covers bots only, and only the owner lists or revokes one (`GET` and `DELETE /api/connector-actions`), on the Connectors page.
- A bot still uses only the apps it was given: a grant lets no bot into an app it does not have.

## Alternatives

- **One "trusted" switch for all actions.** Rejected, as in ADR 055: one page read by a bot would send mail unasked.
- **Ask Composio's tags.** Composio marks a send and a label alike (`createHint`, `updateHint`), so the tags cannot tell what reaches people.

## Consequences

- One yes covers every bot for an action such as "Add label to email with Gmail".
- A name that hides that it reaches people (an action named "CREATE" that mails someone) could be allowed for all; the owner sees the action on its card and is asked whom.
