# ADR-233: A bot may belong to a project without a team

- **Status:** Accepted (2026-11-13, the owner, of a project page with only New team and New card: "Should be possible to add a bot without a team to the project")
- **Changes:** [#816](https://github.com/Kordal/bot-dot/issues/816) (a project's bots were those of its teams alone)

## Context

Since #816 a project's bots are those of its teams: a bot joins a project only by being put on a team, and the bot made from the Chief's suggestion gets a team of its own named after the project. Since ADR 230 the owner picks a bot as the project's Project Manager and talks to the project through it, so a project often needs one or two bots for its work and no team: making a team for each is a step the owner does not want.

## Decision

- **A project keeps its own bots in no team**, `bots` (ids) beside `teams`. A bot put on one of its teams is no longer kept there too: a bot is in a team or in `bots`, never both. A deleted bot leaves it.
- **A project's bots are its teams' bots and its own** (`membersOf`, lib/company.js) wherever botdot asked "is this bot the project's": its folder on the computer, its to-do and calendar tools, the jobs on its calendar, its page's Needs you, a check-in's Stop, the folder's rename while a bot runs, and what of its bots waits in Needs you for its Project Manager.
- **The bot is told the project as any of its bots is** (its scope, goal, delivery, rules, sources, folder and to-do), with "in none of its teams: the owner or its Project Manager gives you its work directly" in place of a team's lead and member rules. Team chats, leads, reports and standups stay the teams'.
- **The Project Manager and the Chief see them**: the Project Manager's brief lists them by id (it gives them work with `message_bot`, the Chief with `run_bot`); the Chief's note of the project lists them, and the Chief changes the list with `set_company_team` and `own: true` (a tool of its own would push its tools past their size limit).
- **The owner adds one on the project's page**: "Add bot" beside "New team" (the account's bots not in the project, and New bot to ask the Chief for one), then the bots stand as keys under the teams, with "+" after them. The project's settings list them under Team, each with ✕. `PUT /api/company/bots` `{ bots }` sets the whole list (feature `project-bots`).

## Alternatives

- **Put the bot on a hidden one-bot team**: the project would show a team the owner never made, and the bot would get a lead's rules and a report rhythm it has no use for.
- **Show every account bot on every project**, as before #816: that leaked bots into projects they have nothing to do with, the reason #816 removed it.

## Consequences

- A bot of a project in no team has no team chat: the owner talks to it in its own chat, or through the Project Manager.
- The suggested bot still joins a team, as before: the Chief suggests it for a team's work.
- An older app ignores `bots`: it shows only the teams' bots, as before, and has no "Add bot".
