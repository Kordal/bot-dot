# ADR-054: A permission card comes only from the bot's ask

- **Status:** Accepted (by the owner, 2026-10-22)
- **Owning task:** [#279](https://github.com/Kordal/bot-dot/issues/279)
- **Amends:** [ADR 009](009-the-botdot-server-carries-on-after-an-ok.md) (a refused tool no longer makes the ask that keeps the run)

## Context

Since Milestone 6 every tool a bot's run was refused because its settings don't allow it (Bash, WebFetch, Edit, Agent…) became a permission card in Needs you by itself, from the result's `permission_denials` (`lib/bots.js` askForRefused). A bot that tried a tool it could do without, or probed one on the way to another route, still put a card in front of the owner. The owner found the cards too many and decided that botdot stops asking on a bot's behalf.

## Decision

- **A refused tool asks nobody by itself.** botdot reads no `permission_denials` to make a card.
- **A permission card appears only when the bot calls `ask_permission`**, with its own reason. The bot's prompt ("ask for a refused tool only if needed") and the tool's description say so: when another route does the job, the bot takes that and asks nothing.
- **Unchanged:** what an ask is and what follows it (ADR 009): the ask keeps the run that asked, a yes carries that run on once, one card per permission, a changed bot that gives the permission takes the run onto its card, and a week without the same ask after a no.
- **Unchanged:** the Chief's rule after web contact, and every other card (Vault, connected apps, calls, overrides).

## Alternatives

- **Keep the automatic card but only for some tools, or only once a day.** Still cards the bot did not need; the owner asked for the bot to decide.
- **A digest of refused tools.** One more thing to read for something the bot can ask for itself when it matters.

## Consequences

- A bot that does not ask leaves the owner without a card: the reply says what it could not do (the honesty rule), and the owner allows the permission in its settings or tells the bot to ask.
- The tests' stand-in Claude asks with `ask_permission` for what it was refused, as a bot that follows its prompt does, so the carry-on tests of ADR 009 run through the bot's ask.
