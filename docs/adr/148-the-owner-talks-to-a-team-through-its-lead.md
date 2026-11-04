# ADR-148: The owner talks to a team through its lead

- **Status:** Accepted (2026-11-04, the owner: "In projects, user should mostly interact with Leaders of the Teams. So whatever a normal bot needs it redirects to Leader which will ask you in return")
- **Supersedes:** in [ADR 114](114-a-team-bot-is-told-its-project-and-a-lead-what-leading-means.md), "a member is told to ask the owner directly when it needs a decision, not the lead" and the rejected alternative "Members' questions go through the lead"

## Context

A project's team has one lead (ADR 110) that answers for the team (ADR 114). A member was told to ask the owner directly for a decision, so a team of six asked the owner from six chats, each question on its own, while the lead, which holds the team's split of the work and its plan, did not see them. ADR 114 rejected a relay because a lead cannot answer for the owner. The owner wants one voice per team: a member's needs reach the lead, and the lead asks the owner.

## Decision

- **A member asks its lead, not the owner,** for what it needs from the owner (a decision, an answer, a file, a login): with `message_bot` (priority: true) in its own runs, by naming the lead in a turn of the team's chat (ADR 119). It asks the owner directly only when the owner wrote to it, or when the lead can't be messaged (kept to the owner, or gone).
- **The lead asks the owner** in its reply, every member's question in one message, each with the member's name, and passes the answer on with `message_bot`. It answers a member itself only from what the owner already said or decided (the decisions, the plan, the project's rules). It still never approves anything for the owner.
- **A card stays the member's.** What only the owner's tap answers (`ask_permission`, `ask_override`, `ask_skill` and the other cards, ADR 054-056) is asked for by the member as before, since a bot never changes another bot's settings and a bot's message is never the owner's OK; the member then tells the lead in one line (priority: false) that it waits, so the lead's next message to the owner can carry it.
- **A team bot may always message its lead, and a lead its members** (`company.teamLinks`, `mayMessageIds` in `lib/bots.js`), whatever "May message" says: the owner made the team. A bot kept to the owner ("Other bots may ask it" off) is still not reached, and a bot outside the team is reached only as its settings say.
- Nothing in the API or the apps changes: the lead's questions reach the owner as any bot's do (Asks in the list, Needs you, the project's to-do).

## Alternatives

- **Members' cards moved to the lead's chat, or drawn under the lead in Needs you.** Left for later: it changes what the apps draw, and the card's question is still the member's own; the project's views of Needs you are being scoped to the team first (#954).
- **The lead approves for the owner within the team.** Rejected again, as in ADR 114: an OK is the owner's.
- **"May message" left as it is, the member told to use ask_permission for its lead.** Rejected: a team whose member could not reach its lead would ask the owner for the right to ask the owner.

## Consequences

- The owner hears from a team's lead; a member speaks to the owner when the owner writes to it, or for a card.
- A member's question waits one hop longer: the lead's run, then the owner. The lead's turn already batches them.
- A team bot's note grows by some 200 characters for a lead and 350 for a member; the bound test of a bot's prompt with every cap hit is 127,000 characters (DECISIONS.md, 2026-11-04).
