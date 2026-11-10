# ADR-205: "Needs you" on a team names who waits

- **Status:** Accepted (2026-11-10, the owner: "Needs you should also distinguish if a member or a group chat needs you")
- **Changes:** ADR 196: a folded team showed a plain "Needs you" when any of its bots waited

## Context

A folded team (ADR 196) said "Needs you" without saying what waited: a member's own chat or the team's chat. A bot in two teams (ADR 199) lit both rows for one ask.

## Decision

- **The row names who waits:** "Needs you: Claude Coder", "Needs you: Team chat", or two names and "+N" for more, in the order they asked.
- **An ask in a team's chat** (a Needs you entry of that chat, or a question a member put there) counts for that team's chat.
- **A bot's own ask** counts on its home team only: the team it leads, else its first team of the project, the team the server reports it under (ADR 199).
- **The same rule on both apps,** from data they already have: `Keypad.teamWaits` on the web, `Spaces.teamWaits` on Android. Nothing changes on the server.

## Consequences

- One ask lights one row.
- A bot in several teams that leads none shows its ask on its first team; its key still shows "Needs you" in every team it is in.
