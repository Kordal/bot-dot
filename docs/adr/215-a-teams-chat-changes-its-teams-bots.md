# ADR-215: A team's chat changes its team's bots

- **Status:** Accepted (2026-11-11, the owner, on the team's settings panel: "Should be possible also to add bot here")
- **Changes:** ADR 119: the owner could not change a team chat's members; ADR 205: the team's panel showed its members with Lead and Make lead only

## Context

A team's ⋯ opens its chat's settings on the right (ADR 205): the members with Lead and Make lead, the reports, the notes. Adding a bot meant closing it and finding "+" at the end of the team's row (#1051); taking one out was only possible by asking the Chief.

## Decision

- **A team chat's members are its team's bots.** `PUT /api/group-chats/:id` with `members` on a team's chat sets the team's `bots` in its project, as `PUT /api/company/teams/:id { bots }` does, and the chat follows (feature `team-chat-members`). A bot put in stays in its other teams (ADR 199); a lead taken out hands the lead to the first bot left.
- **Never down to none.** A team without bots goes with its chat, so an empty list is `400` "A team has at least one bot." Deleting a team stays in Projects.
- **The panel has "Add a bot" and ✕ on each member,** none on the last one, on the web and on Android. On the web, opened from the project's page, "Add a bot" is the team's own picker from "+" (#1051): a bot in another team says which, and "New bot" asks the Chief. Elsewhere it lists the account's other bots, as a group's panel does.
- **Older servers:** without `team-chat-members` the apps keep the panel as it was.

## Consequences

- The owner and the Chief change a team from either place; both go through the project's team, so they cannot drift apart.
- Android's panel has no "New bot" in its picker: the "+" on the project page has it.
