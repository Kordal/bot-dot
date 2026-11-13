# ADR-235: A project opens its manager's conversation

- **Status:** Accepted (2026-11-13, the owner approved the five-PR Projects simplification)
- **Owning task:** [#1328](https://github.com/Kordal/bot-dot/issues/1328), spec [#1327](https://github.com/Kordal/bot-dot/issues/1327)
- **Changes:** The default team conversation of ADR 132; keeps the separate Chief and Project Manager of ADR 230.

## Context

A project opened the first team's chat even when the owner chose a Project Manager to coordinate all its teams. The main conversation field made the same choice. The owner had to know which chat to use before giving work to the project.

## Decision

- A running project's primary conversation is the selected Project Manager bot's own chat, when the server supports `project-manager-bot` and the bot is still there. Otherwise it is the project's own Chief chat, made on first entry through the existing `project-chief` API.
- The wide web chat column and the web and Android primary conversation fields choose the same contact, showing its name and face. Android's wide space navigation makes the same choice.
- Setup opens no primary conversation. A selected bot's list must finish loading before deciding it is gone. A delayed chat creation must not open a project the owner has left.
- Explicit Chief, team and individual bot entry points remain. This does not move messages, change who can approve an action, or remove any team.
- An older server without `project-chief` keeps the ordinary Chief entry. Without `project-manager-bot`, an app does not treat a project's `lead` as a bot that can coordinate teams.

## Alternatives

- Keep opening the first team: it bypasses the contact responsible for the whole project.
- Merge all conversations: it changes history and bot behaviour, and is unnecessary for one predictable entry point.

## Consequences

The owner can give the project work without choosing a team. Existing projects and chat histories stay intact; no new API contract or feature is needed. The fixed overview, secondary Team view, conversational creation and consolidated updates remain later slices of the spec.
