# ADR-217: A project's own Chief chat is its Project Manager

- **Status:** Accepted (2026-11-12, the owner: "I need to have the ability to have a "Project Manager" that will be able to talk to all teams, people etc. So I can only talk with him and this will allow me to have many teams in the same project")
- **Changes:** ADR 148 (the owner talks to a team through its lead): the owner may now talk to every team through one Project Manager; the leads still answer for their teams. The project's own Chief chat (#1263) gets a role.

## Context

A project may hold many teams, each with a lead and its own chat (ADR 110, ADR 119, ADR 199). The owner had to write in each team's chat, or each lead's, and collect the answers. The Chief already had a chat per project, the one botdot's turns about it go to, but it could not write in a team's chat ("You cannot write in a group's chat yourself") and was not told, in that chat, which project it was about.

## Decision

- **The Project Manager is the Chief of Staff in the project's own Chief chat,** not a new bot: it already has every tool for the project (teams, goals, to-dos, bots) and the owner already reaches it from the head beside the project's gear. The apps call that head "Project Manager" (feature `project-manager`).
- **Each turn the owner starts there is told the project:** its name and id, each team with its id, its lead and its members, and how a Project Manager works: split the ask by team, give each team its part once, don't wait, report the outcome and ask, in one message, what only the owner can answer.
- **It writes in a team's chat** with `team_chat` and a text (`POST /api/company/teams/:id/message`, the Chief's alone; `:id` the team's id or name, looked up in the chat's own project first, then in every project). The message goes into the team's chat as any message there does: to the lead without a mention, to the members it names with one, and the lead has the last word (ADR 201). The apps draw it with the Chief's head and "Project Manager", on the bots' side, and never offer to take it back.
- **It is never the owner's word.** Its turns are runs the Chief started (`byChief` on the run, `whoStarted` = `chief`), told so in their prompt, and their history marks the message as the Project Manager's. It answers no member's open question to the owner, and is not counted as the owner writing.
- **The team's answer comes back by itself.** When the line of its message ends, botdot starts a turn of the Chief in the chat that wrote it, with the lead's last word (or every reply) quoted as bots' text. If no turn can start, the answer stands in that chat as the bot's message.
- **It reads a team's chat** with `team_chat` without one (`GET /api/company/teams/:id/chat`): who said what, oldest first, at most 60 lines.
- **No loop.** A turn botdot started (a team's answer) may write to teams again, at most three times in a row before the owner writes in that chat; the fourth is `429` and the Chief tells the owner where it stands.
- **After the web** writing with `team_chat` waits on a card, as any change of the Chief's does: a team's turns would carry what a page wrote.

## Alternatives

- **A new bot "Project Manager" per project, put in every team.** Rejected: a bot cannot make or change bots and teams, would need the Chief for every change, and would sit in each team's turns as a member. The Chief already is the owner's single voice.
- **The Chief starts each lead with `run_bot`.** Rejected: the lead's members answer later in runs of their own that never come back, and the owner sees none of it in the team's chat. A team's chat already gathers the work and ends with the lead's one answer.
- **Leads' questions moved from the owner to the Project Manager.** Left for later: ADR 148 still has a lead ask the owner, in Needs you, from its own runs. In the Project Manager's lines the team's questions already come back to it.

## Consequences

- The owner can run a project of many teams from one chat; the teams' chats stay readable and the owner can still write in them.
- A turn in the project's chat is some 600 characters longer per three teams.
- An older app draws the Project Manager's message as the owner's own bubble; it updates with the next release.
