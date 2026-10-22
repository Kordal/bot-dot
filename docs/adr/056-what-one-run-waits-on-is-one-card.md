# ADR-056: What one run waits on is one card

- **Status:** Accepted (2026-10-22, the owner's request in [#277](https://github.com/Kordal/bot-dot/issues/277): "too many approvals").
- **Owning task:** [#277](https://github.com/Kordal/bot-dot/issues/277).

## Context

Every ask is its own card in Needs you and its own notification. One bot run that wants several things (three emails through a connected app, a permission, a rule lifted) makes as many cards, each answered on its own, each ringing the phone. The Chief after it read the web is the same: every change it makes in that chat is a card (`chief-action`, ADR 033). The owner found it too much.

The rules of each card stay right: an action in a connected app is allowed for its exact arguments (ADR 010), a run that waits for several asks carries on once after the last answer (ADR 009), and a Vault secret needs the owner's own yes (#253, ADR 051). What is wrong is how many times the owner is asked to look and tap.

## Decision

- **The asks of one run share one card.** The server gives each ask of `GET /api/asks`, of the feed's `asks` event and of `hello` a `batch` (`{ id, title, count, own? }`) when another ask shares where it was asked: the bot's run that waits for it (`run-<id>`), or, for the Chief's asks and what the Chief proposed for a bot, the Chief chat (`chat-<id>`). An ask alone there has none and is drawn as before.
- **The card** is the server's title ("Proton Triage wants 3 things for “Reply to the landlord”", "The Chief wants 2 things in “Trip”"), **Decline all**, **Allow all**, and each ask's own card under them with its own buttons, so that nothing is approved unseen and any ask can still be answered alone.
- **Allow all and Decline all are the asks' own answers, in turn.** `POST /api/asks/batch/:id` answers each ask of the card, oldest first, exactly as `POST /api/asks/:id` with `{ yes }` would: the same grants, the same carry-on (one run carries on once, after the last), the same week-long block after a no. An ask that can't be answered (a bot that changed since a proposal) keeps its card and its reason; the others are answered.
- **Allow all gives no yes that needs the owner's own** (`own: true`): a switch of a saved login, a secret kept in a file, an entry removed from the Vault, and an action too long to show in full, which can't be allowed once. They stay on the card for their own button. Decline all says no to them too.
- **One notification per card.** A phone (web push and Android) rings for the first ask of a card, with the card's title and no answer buttons; an ask that joins it later, or the first answered on its own, rings nothing new.
- **Only asks.** A waiting job, a Board tile, a memory change and a login request stay cards of their own: they have their own lists and routes, and Needs you's "Approve N" already takes AI jobs and memory changes at once (Milestone 8).

## Alternatives

- **One ask per run, made by the server, with a list inside.** Every rule of each kind (the exact arguments of an action, decline memory, the grants) would have to be written again for the list. Keeping each ask as it is and grouping only how it is drawn and answered keeps every rule in one place.
- **Allow all covering the Vault kinds.** It would let one tap put a secret in a file or on the account's computer, which #253 decided needs the owner's own yes on its own card.
- **Grouping in the apps alone.** Both apps would have to agree on what belongs together, and a phone notification would still ring once per ask. The server decides it once (AGENTS.md, Architecture principle).

## Consequences

- Fewer taps and fewer notifications for a run that wants several things; the number of asks is the same.
- An app from before `ask-batches` ignores `batch` and shows each ask as before; its answers still work.
- Jobs, tiles and memory changes of the same run are not on its card yet. Joining them would need their answers behind the same route.
