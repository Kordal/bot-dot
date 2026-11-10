# ADR-191: A lead's report moves the goals it plainly reached

- **Status:** Accepted (2026-11-10, the owner's "Tak" on F, #1119)
- **Changes:** ADR 121: a goal's number changed only by the owner, the Chief's `set_company_objective` or an app source
- **Keeps:** ADR 121's rule that no bot gets a tool that writes to the project; the 2026-11-04 decision on removing a goal

## Context

A team shipped a step or reached a number, and its lead said so in its report, but the goal cards stayed as they were until the owner asked the Chief to update them. The goals looked frozen while the team worked.

## Decision

- **After a report, one call reads it.** When a lead posts its report, one short call of Claude with no tools and no run reads it beside the project's goals, as the standup's call does (ADR 117), and answers JSON moves.
- **botdot makes only what a report can move:** a goal's `current`, when no app source reads it, and a step ticked done. At most six. Never a target, a name, a goal's removal or a step unticked; a goal that is done is left out.
- **Said where the owner reads it.** Each report that moved something gets one line of botdot's in the project's Chief chat ("Growth's report moved the goals: Weekly users 120 → 140; "Landing page" done."). A wrong move is set back on the goal card.
- **The report is text, never instructions:** it stands inside an inert block, and the answer is checked against the goals as they are.

## Alternatives

- **A lead's tool to tick steps or set numbers.** Rejected, as in ADR 121: a page a lead read could steer it to write to the project.
- **Telling the Chief each report for a turn.** Rejected: a Chief turn per report costs more, can do far more than move a goal, and makes a message the owner did not ask for.

## Consequences

- The goal cards follow the team's reports.
- A report that misstates a number moves the card; the line in the Chief chat shows it, with the number before.
