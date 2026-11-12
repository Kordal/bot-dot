# ADR-222: A Chief message names the team it is about

- **Status:** Accepted (2026-11-12, the owner picked option A of the mockups, with the project's name in the Chief's other chats)
- **Builds on:** [ADR 217](217-a-projects-own-chief-chat-is-its-project-manager.md) (the Project Manager), [ADR 211](211-a-bot-asks-in-one-place-at-a-time.md)

## Context

The Project Manager writes to several teams at once, and their answers come back one after another as its own replies in one chat. In the chat they read as one stream of text: the owner could not tell which reply was about which team, nor which team their own answer went to.

## Decision

- **A Chief message carries `about`:** its team (id, name, colour), decided by the server, never by the model. The Chief's turn about a team's answer is about that team; a turn that wrote to exactly one team (`team_chat`) is about it, and so is the owner's message that started it; a turn that wrote to two teams or more is about none.
- **The project is named only outside its own chat:** in the project's own Chief chat its name is in the header already; in the Chief's other chats every project mixes.
- **The apps draw it above the message**, web and Android alike: a square and the team's name in its colour, a tap opens the team's chat. No other text.
- **The Chief's turn about a team's answer is told to keep to that team**, so one message stays one topic.

## Alternatives

- **Sections per team in the Project Manager's chat** (mockup B): breaks the order of the conversation and folds into an accordion on a phone.
- **A quote of what each reply answers** (mockup C, as #1256): repeats text and helps only with short messages.
- **The model names the topic itself:** unreliable, and a label the server cannot check.

## Consequences

- A team renamed or recoloured later keeps its old name on messages already written.
- A reply that covers several teams has no label; its "Messaged" chips still name each team.
