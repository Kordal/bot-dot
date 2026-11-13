# ADR-227: The owner picks a bot to lead the project

- **Status:** Accepted (2026-11-12, the owner: "the user must be able to designate the project lead", and picked "a bot runs the project" over "a team's lead is enough"); changed by [ADR 230](230-the-project-manager-is-the-bot-the-owner-picked-and-the-projects-chat-is-the-chiefs.md): the bot runs the teams from its own chat, and the project's chat stays the Chief's
- **Builds on:** [ADR 217](217-a-projects-own-chief-chat-is-its-project-manager.md) (the Project Manager), [ADR 223](223-a-chief-message-names-the-team-it-is-about.md)

## Context

A project's own Chief chat is its Project Manager (ADR 217): the owner talks to the whole project there, and the Chief splits the work among the teams. Who runs the project was fixed: always the Chief, with its head and the words "Project Manager". The owner wants to name the project's lead: one of their bots, with its face and name, in the Chief's place.

## Decision

- **A project has `lead`:** a bot's id, set by the owner alone in the project's settings (`PATCH /api/company { lead }`, `null` for none). Any bot of the account may lead, the project's own are offered first. A deleted bot leaves the project without a lead.
- **The lead speaks in the project's own chat, the Chief's engine runs it:** each turn there is told that it speaks as that bot, in its name and first person, with the bot's job. The Project Manager's tools, the team answers coming back, the limits of ADR 217 stay as they are.
- **The apps draw it as the lead:** the head beside the gear, the chat's header, and its messages in the teams' chats (`as` on the message) have the bot's head and name instead of the Chief's. The Chief's list of chats says which chat has a lead (`lead`).
- **A team's turn is told who wrote** the Project Manager's message: the project's lead, by name.
- **Without a lead nothing changes:** the Chief is the Project Manager, as before.
- With it, a team's chat picks its team's lead in its own panel (`team-chat-lead`), on the web from any page and on Android, which had no such control there.

## Alternatives

- **The lead bot's own runs answer in the project chat:** a bot's run has no Project Manager tools (team_chat, set_company_team, the cards), and would need them all again, with their limits. Days of work for the same conversation.
- **A team's lead is the project's lead:** the Chief stays in front; the owner asked for the person in charge to change.

## Consequences

- What the lead says in the project chat is not in its own 1:1 chat, and its own notes are not read there: the project chat keeps its own history, as before.
- The lead's name is the owner's text, put in the prompt as text, never as an instruction.
