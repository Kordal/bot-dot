# ADR-123: A card on a project's board is built and kept fresh by a run of the Chief's

- **Status:** Accepted (2026-10-29)
- **Owning task:** [#775](https://github.com/Kordal/bot-dot/issues/775), spec [#774](https://github.com/Kordal/bot-dot/issues/774)
- **Builds on:** [ADR 073](073-the-chiefs-own-jobs-only-read.md) (a run of the Chief's own that only reads), [ADR 121](121-an-objectives-number-is-read-from-a-connected-app-by-a-read-only-run-of-the-chiefs.md) (an objective's number), [ADR 112](112-the-chief-helps-set-up-a-company-in-short-calls-and-botdot-reads-its-site.md) (short calls), [ADR 004](004-pieces-as-restricted-shape-lists.md) (nothing from Claude is markup)

## Context

The owner wants the Projects board to show small live cards they ask for in their own words ("Tracker for GitHub issues", "Number of customer calls"), anything. The Chief should ask at most three questions, then build the card itself, from the web or the owner's connected apps.

## Decision

- **A card is the project's,** kept in `data/project-cards.json` by project: its ask, the answers, its state (`asking`, `building`, `ready`, `failed`), what it shows (`body`) and `how` (the run's note of how it read it). The apps get it on the project (`cards`), without `how`.
- **The questions are one short call** with no tools (as the setup's help, ADR 112): a title, zero to three questions with up to four ready answers each, and which connected apps the card reads. A failed call builds the card from the ask alone.
- **A run of the Chief's own builds it** (as a job's, ADR 073): no chat and no tool that changes botdot. With apps it reads them read-only and has web search only, as a job does; without, it also reads web pages, as a page's run does. So a page it picks never sees the owner's app data. It answers one fenced `card` JSON object, or `FAILED: why`; botdot checks it field by field and keeps plain text and numbers only, which the apps draw with their own code. Its tool calls are the card's live line (`step`).
- **One card run at a time,** in a slot of its own: a card does not wait for a look, a job or a page's run.
- **Fresh:** a day after its last try while the project runs (not archived), and on the owner's Refresh, a run reads it again, handed `how`. A refresh that fails keeps what the card showed and says why on it.
- **The owner's alone:** add, answer, change (asks anew; Close puts the card back as it was), refresh, remove. The Chief has no tool for cards yet.

## Alternatives

- **A tile of the Board with a script source** (ADR 071): refreshes without AI, but a script needs the owner's approval card, and "anything" the owner asks for rarely has an endpoint a script can read without the Chief working out how first.
- **A bot per card:** a bot, its job and its approvals for one number.
- **Questions asked in the Chief's chat** (mockup B): the owner leaves the board to answer.

## Consequences

- A card costs one Claude run when built and one a day after.
- Twelve cards at most per project.
- Android draws them in #776; an app without `project-cards` in `features` shows none.
