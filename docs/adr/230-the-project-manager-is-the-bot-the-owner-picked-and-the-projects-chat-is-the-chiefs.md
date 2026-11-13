# ADR-230: The Project Manager is the bot the owner picked, and the project's chat is the Chief's

- **Status:** Accepted (2026-11-13, the owner, of the head beside the project's gear: "This button should redirect to Chief Of Staff. But ANOTHER bot - decided by the user should act as Project Manager that talks to all teams")
- **Changes:** [ADR 227](227-the-owner-picks-a-bot-to-lead-the-project.md) (the lead spoke as a persona in the project's own Chief chat), [ADR 217](217-a-projects-own-chief-chat-is-its-project-manager.md) (that chat was the Project Manager)

## Context

ADR 217 made the project's own Chief chat its Project Manager, and ADR 227 let the owner pick a bot to lead it: the Chief's engine kept running that chat and only spoke in the bot's name, with its head on the button beside the gear and on the chat. The owner reads the button as the Chief of Staff's, and wants the Project Manager to be another bot, one they pick, that talks to all the project's teams.

## Decision

- **The head beside the gear is always the Chief of Staff's** and opens the project's own Chief chat, headed with the Chief's name. No bot's head or name stands in for the Chief there, and `GET /api/chief` no longer lists that chat with `lead`.
- **The bot the owner picks (`lead`, unchanged in the API) is the project's Project Manager in its own chat.** Each run of that bot outside a team's turn is told the projects it runs, their teams with their leads and members, what of their bots waits in Needs you, and how a Project Manager works. It gets `team_chat` among its own tools (feature `project-manager-bot`): with text it writes in a team's chat, without it reads it.
- **Its message in a team's chat is its own:** `as` its id beside `by: "chief"`, drawn with its head and name, and the team's turns are told the Project Manager, that bot, wrote it, never the owner. The limits of ADR 217 stay: no member's question is answered by it, and at most three writes in a row from runs the owner did not start.
- **A team's answer comes back to the bot's own chat**, in a run botdot starts with the team's words as bots' text; the bot tells the owner there.
- **The project page draws the bot's head beside the Chief's**, opening its chat. Settings call the picker "Project Manager"; its empty choice is the Chief.
- **With no bot picked the Chief is the Project Manager**, in the project's own chat, as in ADR 217. With one, the Chief there hands the teams' work to the bot with `run_bot` and keeps making and changing teams, bots, goals and the board.

## Alternatives

- **Keep the persona in a chat of its own** (a second Chief chat per project, in the bot's name): the bot's own chat and that chat would be two conversations with one face. The owner asked for a bot.
- **Make the Project Manager a member of every team:** it would take a turn in each of their lines, and ADR 217 rejected it.

## Consequences

- What the Project Manager knows of the project and its teams is in its own chat and memory, as for any bot.
- It cannot make or change bots and teams: it hands those to the Chief with `send_to_chief`.
- A bot's run is some 600 characters longer per three teams of each project it runs.
- An older app keeps drawing the head beside the gear as it was: with a bot picked, the bot's head opening the Chief's chat. It updates with the next release.
