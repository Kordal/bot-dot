# ADR-143: An ongoing project has no 90 days

- **Status:** Accepted (2026-11-03)
- **Owning task:** [#925](https://github.com/Kordal/bot-dot/issues/925)
- **Changes:** [ADR 127](127-the-chief-picks-a-new-projects-setup-questions-and-the-server-sends-its-screens.md) (what the shape `ops` means)

## Context

A project was built around a destination: the start screen said "You know where. We'll work out how.", the review asked for a 90-day goal and a delivery date, the board counted "Day N of 90" and check-ins waited on days 30, 60 and 90. The owner also runs things that never end: a home, a car, the household's money, a homelab. The Chief already reads such an ask as the shape `ops` (ADR 127), but everything after the questions still assumed a finish line, so "Home" got a countdown to a day 90 that means nothing.

## Decision

- **A project whose setup shape is `ops` is ongoing.** The server decides it from `setup.shape` and says `ongoing: true` on the project view (feature `project-ongoing`); the apps draw from that flag and from what the server already sends.
- **No 90 days.** No delivery screen in its setup and no delivery row in its review or settings; no "90 days" piece on its board (the view leaves `days` out of `board`, the apps don't offer it); its objectives default to a bar or a status, never a pace chart to day 90.
- **A monthly review in place of the check-ins.** One waits on day 30, 60, 90, 120 and on, every 30 days from its start, with the same card and answers (Keep going, Change direction, Stop); an objective is on track once it is met. The calendar shows each one ahead as `monthly: true`.
- **Its goal is what should keep working.** The Chief asks "What should keep working?" for its goal chips, and every prompt that said "90-day goal" and "day N of 90" says "What should keep working" and "ongoing, no end date, running since …".
- **The Chief reads home, car, money and paperwork as `ops`;** the team puts recurring upkeep in its bots' routines and proposes states to keep as goals.
- **One noun.** It stays a project in the UI, the API and the tools; the start screen says "What shall we take on?" over "Goal, matter or site", which fits both kinds.

## Alternatives

- **A second noun, "area" beside "project".** Rejected: two words for one thing in the UI, the API and the bots' tools, and the owner would have to pick one before saying what it is. The Chief already tells them apart.
- **A switch on the start screen (goal or ongoing).** Rejected: a control and a choice for what the Chief reads from one sentence.
- **Only new start-screen words.** Rejected: "Home" would still count to day 90 and ask for a delivery date.

## Consequences

- A project set up as `ops` since ADR 127 becomes ongoing at once: its 90-day line goes from the board and its next review is the last 30-day mark it reached.
- Venture and goal projects keep their 90 days unchanged.
- A check-in day is any multiple of 30 up to 3650, not only 30, 60 and 90.
