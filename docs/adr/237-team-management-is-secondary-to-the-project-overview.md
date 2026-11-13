# ADR-237: Team management is secondary to the project overview

- **Status:** Accepted (2026-11-13, the owner asked to implement the next approved slice)
- **Owning task:** [#1330](https://github.com/Kordal/bot-dot/issues/1330), spec [#1327](https://github.com/Kordal/bot-dot/issues/1327)
- **Changes:** The team rows in the default project view of ADR 236 and the placement of Add bot in ADR 233. Keeps the manager and Chief roles of ADR 230 and the primary conversation of ADR 235.

## Context

The fixed overview still ends with team organisation, New team and Add bot. Those are useful when managing the work, but unnecessary before telling the project what to do.

## Decision

- On servers with `project-overview`, the main project view shows the fixed overview and its primary conversation, with Team as a secondary entry on web and Android.
- Team reuses the existing membership and lead editors, Project Manager selection, team creation, standalone project bots and explicit team/bot chats. The full project settings and saved Board remain accessible.
- Overview returns from Team. Returning from a secondary chat keeps Team visible; explicitly choosing another project starts its overview. No membership, permission, chat history or coordination rule changes.
- Existing feature checks still control each editor. Older servers keep their original project view. No new API shape, data migration or feature flag is required for this navigation change.

## Alternatives

- Delete the editors and force every existing operation through chat: removes useful explicit controls before conversational creation is delivered.
- Keep team organisation under the overview: leaves the main flow responsible for two different jobs.

## Consequences

The main view is for understanding the outcome and giving work to its primary contact. Team is for inspecting and changing who does that work. Saved Boards retain their original controls and arrangement. Conversational creation and consolidated updates remain separate tickets.
