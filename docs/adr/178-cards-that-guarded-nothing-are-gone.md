# ADR-178: Cards that guarded nothing are gone

- **Status:** Accepted
- **Owning task:** the owner's OK of 10 November 2026 on the approvals audit (https://claude.ai/artifact/EDDPL7ABQ5FVEbcq2NApJK)
- **Changes:** [ADR 059](059-a-note-is-saved-without-an-ok.md) (removals still waited), [ADR 054](054-a-permission-card-comes-only-from-the-bots-ask.md) (helpers), [ADR 064](064-a-check-a-bot-offers-runs-on-the-owners-yes.md) (a bot's own AI job), [ADR 153](153-a-bot-saves-a-secret-in-the-vault-on-the-owners-yes.md) (a new secret), [ADR 067](067-the-owners-mention-in-a-room-runs-the-bot-with-every-step-on-a-card.md) (every tool in a room run), [ADR 103](103-a-bots-proposed-main-assignment-is-tried-on-its-past-tasks-before-its-card.md) (a change the owner asked for in a clean run)

## Context

The audit of every card botdot puts in Needs you found six whose yes changes nothing that cannot be undone or seen, and leaks nothing: the owner taps them because they are there.

## Decision

- **A removal of a note is done at once**, in every run and Chief turn that may touch the note: a shared note after outside content, and what the owner said outside a clean run or turn. A removed note comes back for 30 days, and the row under the reply says it (`told`, and `said` for what the owner said). A forget, which erases for good, still waits on its card.
- **Helpers are given at once.** `ask_permission` for `helpers` adds the Agent tool to the bot with no card: a helper works with the run's own tools and grants. It is there from the bot's next run.
- **A bot's own AI job is approved at once** when the bot sets it up in a run the owner started that has read nothing from outside, and it has no script, call, notify address or logins. A change to an approved job still waits beside it (ADR 013).
- **A new secret a bot saves goes into the Vault at once**, shared with that bot alone, with an audit line (`vault.saved`, actor `bot`). Replacing the secret of an entry the bot has still waits on its card, where the owner can show it.
- **A bot's change to its own main assignment or rules is saved at once** in a run the owner started that has read nothing from outside: the owner asked for it, so no page could have. The bot's history keeps the old text, and one tap undoes it; the row under the reply says it (`instructions`, `told: true`). After outside content, or in a run the owner did not start, it still waits on its card, tried first on past tasks (ADR 103). This changes [ADR 103](103-a-bots-proposed-main-assignment-is-tried-on-its-past-tasks-before-its-card.md) for the clean run.
- **A room run's reads take no card**: `Read`, `Glob`, `Grep`, `LS`, `NotebookRead`, `TodoWrite`. Every other tool still waits for the owner's yes, and what the bot posts to the room waits on its post card.

## Alternatives

- Keep each card with an "Always allow": rejected, the first tap still guards nothing.
- Give a room run all tools: rejected, a command or a web request can send the owner's data out without a post.

## Consequences

- Fewer cards, and bots that go on without waiting for a tap.
- What a bot did is in its place: the reply's rows, the bot's jobs, the Vault, its history. The owner removes or turns off there.
