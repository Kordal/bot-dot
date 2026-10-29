# ADR-114: A team bot is told its project, and a lead what leading means

- **Status:** Accepted (2026-10-29)
- **Owning task:** [#693](https://github.com/Kordal/bot-dot/issues/693), spec [#687](https://github.com/Kordal/bot-dot/issues/687)

## Context

A project (the Company place, ADR 110) has teams of bots, each with one lead. Only the Chief's prompt said so: a bot's own prompt said nothing of its project or team, so a lead asked "are you the team's lead?" answered that it was not, and a member could not tell who leads it.

## Decision

- **Every bot in a team gets a short note in its prompt** (`lib/company.js` `botNote`, placed beside the teammate list in `lib/bots.js`): the project's name, its 90-day goal, its team, who leads it, and the other members with their one-line jobs (the bot's description) and ids. A bot in no team, or with no project, gets nothing. The note is read from `data/company.json` at each run, so it follows a new lead, a new goal or a bot that leaves.
- **The lead is told what leading means:** it answers for the team; when the owner asks the team for something it splits the work among the members with `message_bot` (priority: true) and collects what they send back into one reply; the owner may still message any member directly; it never approves anything for the owner.
- **A member is told** to work its part, send the lead what it asks for, and ask the owner directly when it needs a decision, not the lead.
- **The owner's texts in it are bounded and inert:** the project and team names at 40 characters, the goal at 160, a job at 60, six members named and the rest counted, each on one line with no tag (`prompt-text.js` `oneLine`). The fixed words are some 350 characters for a lead and 150 for a member; with every text at its longest and full of "<" a lead's note is under 1,400 characters.
- **The prompt's bound test grows to 125,500 characters** (`test/prompt-private.test.js`), with each bot there leading a team of 20 at the longest texts: 117,911 measured in plain words and 124,499 made of tags. As in DECISIONS.md (2026-10-20, 2026-10-22) the bound checks the caps; it is not a hard limit.

## Alternatives

- **The lead decides for the owner within the team.** Rejected: approvals are the owner's (ADR 054-056); a bot's message is never the owner's OK.
- **Members' questions go through the lead.** Rejected: a lead cannot answer for the owner, so a relay only delays the question.
- **The whole project (objectives, plan, check-ins) in every bot's prompt.** Rejected: the bot prompt is at its cap; what a member needs is who it works with and toward what.

## Consequences

- A team bot's prompt grows by a few hundred characters; a bot in no team's does not change.
- A lead with no bots it may message (`mayMessage`) is still told to split work: it asks the owner for that with `ask_permission`, as any bot does.
