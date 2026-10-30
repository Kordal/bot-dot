# ADR-129: Create puts what it made on the board

- **Status:** Accepted (2026-10-30)
- **Owning task:** [#810](https://github.com/Kordal/bot-dot/issues/810)
- **Builds on:** [ADR 123](123-a-card-on-a-projects-board-is-built-and-kept-fresh-by-a-run-of-the-chiefs.md) (cards built by a run of the Chief's), [ADR 127](127-the-chief-picks-a-new-projects-setup-questions-and-the-server-sends-its-screens.md) (setup that fits the ask), [ADR 128](128-create-grants-what-the-team-cards-show.md) (Create is the owner's one OK)
- **Narrows:** [#780](https://github.com/Kordal/bot-dot/issues/780) (a new project starts with an empty board)

## Context

Since #780 a new project's board starts empty, so the owner can design it. But a project set up with the wizard ended on that empty board too: eight screens of answers and a team, then a blank page with no objectives. The owner approved, on 30 October 2026, that Create builds a starter board from the setup.

## Decision

- **The Chief proposes the board with the team,** in the same call: one to three objectives (a name and a number to reach, 0 for one that is done or not) and two to four live cards, each an ask in the owner's words and the connected apps it reads. They are kept on the project as `starter` while it is set up.
- **The Team step lists them, each ticked.** The owner unticks what they don't want; "Change the team…" leaves them as they are.
- **Create makes the ticked ones:** each objective, and each card built at once from its ask by the run of ADR 123, with no questions, since the setup answered them.
- **The board shows what Create made:** `goals` when it made objectives, `teams`, and `todo` when the plan has an item. The cards are always there. One rule covers both starts: Start from scratch makes nothing, so its board stays empty, and a project the owner set up shows what was set up.

## Alternatives

- **Templates per kind of project** (Homelab, Startup): the Chief reads the ask anyway, and a fixed list fits few.
- **Cards that ask their questions after Create:** the owner answers the setup and then again on each card.
- **Leave the board empty and suggest pieces:** the owner who just reviewed a team still lands on nothing.

## Consequences

- Create costs one card run per ticked card, then a refresh a day, as a card the owner adds.
- A homelab card that needs a login fails with "needs login" until the owner adds one to the project's logins (ADR 126); the team's Vault picks are not copied there.
- The 90-day line (`days`) stays off the starter board until its horizon follows the delivery date.
