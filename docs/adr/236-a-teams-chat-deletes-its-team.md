# ADR-236: A team's chat deletes its team

- **Status:** Accepted (2026-11-13, the owner: "here should also be able to delete the team", on a team's chat settings)
- **Amends:** [ADR 119](119-a-teams-chat-is-a-group-that-follows-the-team-and-a-message-without-a-mention-goes-to-its-lead.md) (the owner cannot delete a team's chat)

## Context

A team's chat follows its team: its name, bots and lead are changed in its settings (`team-chat-rename`, `team-chat-members`, `team-chat-lead`), and the change goes to the team. Deleting was the one thing left out: `DELETE` of a team's chat answered `409`, and the team was deleted only in the project's settings, under Team, Edit. The owner looked for it in the team's chat settings and did not find it.

## Decision

- **`DELETE /api/group-chats/:id` of a team's chat deletes its team** in the project that has it, as `DELETE /api/company/teams/:id` does, and the chat goes with the team (`syncTeams`). Its bots stay, and so do their runs. Announced as `team-chat-delete` in `features`.
- **The owner's alone,** as in the project's settings: the Chief gets `403`.
- **The apps** show "Delete team" in red at the end of a team's chat settings on a server that does it, and ask first: "Delete the team {name}? Its chat is erased. Its bots stay." A server without it: no button, as before.

## Alternatives

- **Delete only the chat, keep the team.** Rejected: a team always has its chat (ADR 119), and the next change of the project would make it again.
- **A link to the project's settings instead of a button.** Rejected: two taps more for the same question.

## Consequences

- A team can be deleted from two places: its chat's settings and the project's settings. Both ask first and say its bots stay.
- An older app ignores the feature and shows no button; an older server never sends it.
