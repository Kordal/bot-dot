# ADR-247: A project's own changes after the web need no card

- **Status:** Accepted
- **Owning task:** the owner's request of 15 November 2026 ("no need to ask for it"), on two "Change your project" cards of the Chief in a project's chat
- **Changes:** [ADR 033](033-the-chief-reads-the-web-and-what-it-changes-after-waits.md) (every change of the Chief's after the web waits), in the spirit of [ADR 176](176-what-the-owner-asks-the-chief-for-in-their-own-turn-needs-no-card.md) and [ADR 178](178-cards-that-guarded-nothing-are-gone.md)

## Context

In a Chief chat that had read the web, every change to a project waited on a `chief-action` card: putting bots in a team and making one its lead, and the Project Manager's message to a team (`team_chat`). The owner tapped Approve because the cards were there. They guarded nothing the owner could not see and undo: a team's bots and lead are on the project's page, a message to a team is in that team's chat. The cards also showed the bots by their ids ("a5ef8c1d"), not their names.

## Decision

- **A project's own changes are not held.** The Chief's project routes but a `DELETE` and a board card (teams, their bots and lead, the project's bots, a message to a team, to-dos, decisions, the plan, goal, dates, standup, updates, layout, suggestion and calendar events), and making or changing a group (`group-chats`), are done at once in a chat that read the web. `FREE_PROJECT_AFTER_WEB` in `server.js` names them one by one, so a project route added later is held until it is decided. They stay inside the account, cost nothing more than the runs the owner already lets the Chief start, and are seen and undone where they are.
- **A team's turns on such a message start as runs that read the web.** The message's words may be a page's, so the team's turns on it get `"web"` in `outside` and `readOutside`, as a task the Chief gives a bot does (ADR 066). Each bot's own cards still hold what reaches outside the account.
- **What still waits, and why.** A board card (`company/cards`, adding or changing one): its build is a Chief run on a schedule with the project's saved logins and connected apps, so its words reach outside the account on every refresh. A deletion (a project's card, event or goal, a bot, a job, a reminder): it removes what the owner may want back. Making, changing or deleting a bot and its jobs: they change what a bot may do unasked. Skills, SSH keys, settings, memory and the Board: they change how botdot or every bot behaves, or reach out (a tile's http read). Connected-app writes keep their own cards (ADR 047): they act outside the account. A tool install keeps its card: it puts code on the machine.
- **A held card names bots by their names.** The rows of a `chief-action` card show every bot the Chief named by its id by the bot's name now. The yes still sends the body as it was held.

## Alternatives

- **"Always allow changes to your project"** (ADR 055's way): one card first, and the owner asked for none.
- **Free only teams and `team_chat`**: the to-dos, cards, plan and calendar are the same kind of change, and the next card would be the same complaint.

## Consequences

- A page that persuades the Chief can change a project's teams or write to a team. The team's bots then work as runs that read the web, with their own cards in front of anything that leaves the account.
- Fewer cards in a project's chat; the Chief tells the owner what it changed, and the project's page shows it.
