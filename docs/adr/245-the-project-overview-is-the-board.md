# ADR-245: The project overview is the board

- **Status:** Accepted (2026-11-15, the owner approved merging the overview into the board)
- **Changes:** The fixed overview of ADR 236 and its Board entry; keeps Team as the secondary entry of ADR 238 and the board's canvas of ADR 124.

## Context

A project had two pages: the fixed overview (Needs you, Goal, Current work, Blockers, Latest replies, Files) and the board the owner and the Chief arrange. The owner asked the Chief to take Goal off the overview, and the Chief could not: no tool changed the overview, and nothing in the app did. Two pages that both answer "what is going on" also overlap (Files was on both).

## Decision

- On a server with `overview-board`, the board is the project's one page. Needs you, Current work, Blockers and Latest replies are board pieces and tiles (`needs`, `work`, `blockers`, `replies`), drawn from the same overview snapshot. Goal is gone; the overview's Files is the board's Files tile.
- The four are put once at the top of every board (`overviewOn`), as Files was (`filesOn`). Needs you shows only when something waits.
- The Chief's `arrange_project_board` and a team bot's `arrange_project_board` hide and show any piece, besides placing tiles. Taking one off (Needs you among them, where what waits for the owner shows) is the Chief's only in a turn the owner started by asking, and a bot's only in a run the owner started that read nothing from outside, so read content never hides what waits. The owner puts a piece back with New card's picks; taking one off is by chat, as AGENTS rule 5 asks.
- Team stays the secondary entry (ADR 238): the team rows leave the board for it.
- Older servers keep the overview with its Board entry; the overview endpoint is unchanged but for its dropped `goal`.

## Alternatives

- A second arrangeable page (sections the Chief orders and hides on the overview): two layouts to learn and keep, for one question.
- Keep the fixed overview: the owner's and the Chief's "take it off" has no answer.

## Consequences

One page holds status and work, arranged one way, by the owner and the bots alike. The Chief may now change which pieces show, which before only the owner could.
