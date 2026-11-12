# ADR-218: In a chat the owner reads, a bot asks the owner itself

- **Status:** Accepted (2026-11-12, the owner: "A bot asks another bot to ask me, when I'm already in this chat")
- **Amends:** [ADR 148](148-the-owner-talks-to-a-team-through-its-lead.md) in a team's chat; [ADR 201](201-the-lead-has-the-last-word-in-its-teams-chat.md), "no question to the owner" for a member

## Context

ADR 148 has a team member ask its lead, not the owner, for what only the owner can give, and the lead ask the owner. That was written for a member's own runs, where the owner is not there. In a team's chat a member's turn was told the same (`MEMBER_RULES_GROUP`, `RULES.toLead`): "name the lead and ask it, not the owner". The owner reads that chat, so a member wrote "@Lead, please ask the owner whether ..." in front of the owner, and the owner waited one more run for a question already on the screen.

## Decision

- **In a group's chat a bot asks the owner itself.** A member that needs a decision, an answer, a file or a login from the owner asks the owner at the end of its own reply, as one recommendation and one yes or no question. Its question shows as the group's open question (Asks, ADR 211) like any member's.
- **A bot is never named to ask the owner for another.** `RULES.handOn`, for every group: a member is named to hand the work on or to ask it for a fact, never to have it ask the owner.
- **The lead does not ask again.** Its last word (ADR 201) and its note in a turn (`LEAD_RULES_GROUP`) say that a member that asked the owner has asked already; the lead answers such a question only from what the owner already said or decided.
- **Outside the chat nothing changes.** In a member's own runs, where the owner is not, ADR 148 stands: it asks its lead with `message_bot`, and the lead asks the owner. Cards stay the member's.

## Alternatives

- **Keep the relay, hide it from the owner.** Rejected: the owner still waits for the lead's run, and a question that exists should be asked once.
- **Fold no member reply that asks the owner.** Not needed: the open question is drawn on its own above the message box, whatever is folded.

## Consequences

- A member's question reaches the owner one run sooner, in its own words, and the owner answers it from the tile.
- The lead's last word can still come after a member that asked, but carries no copy of that question.
- Prompt-only change: no API, no app change.
