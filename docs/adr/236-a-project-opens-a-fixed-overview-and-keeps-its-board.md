# ADR-236: A project opens a fixed overview and keeps its Board

- **Status:** Accepted (2026-11-13, the owner approved the five-PR simplification and asked to implement the next slice)
- **Owning task:** [#1329](https://github.com/Kordal/bot-dot/issues/1329), spec [#1327](https://github.com/Kordal/bot-dot/issues/1327)
- **Changes:** The default Board-first project home of ADR 132. Keeps the saved Board and its layout of ADR 124 and the primary conversation of ADR 235.

## Context

Projects asks the owner to arrange a Board, choose chart styles and create cards while trying to understand the work. A project needs an immediate account of its goal, recorded work, blockers and recent output without making those configuration choices.

## Decision

- A server with `project-overview` offers a fixed overview as a running project's default view on web and Android. The owner's saved Board stays intact behind Board, with Overview returning to the fixed view. No layout or card is migrated or deleted.
- An owner-only, read-only `GET /api/company/overview` supplies bounded recorded activity and recent replies. The server classifies active runs, open to-dos, current questions and latest failures. It computes no completion percentage or inferred progress. Bot activity comes from project members and the selected manager; turns in other teams or ordinary groups are excluded. A bot's own chat may serve more than one project: its activity is labelled with its name, not represented as proof of this project's progress.
- Only successful finished runs and completed, non-error Chief replies enter recent replies. A reply remains a reply, not proof the goal was met. Failed and incomplete work stays separate.
- The apps poll the visible overview every 30 seconds and let the owner refresh. A failed refresh keeps explicitly labelled saved information. Initial loading, missing information, empty sections and file errors/offline state are explicit. The existing project-files read never starts the computer.
- Needs you retains the existing review/approval flow; the overview never grants permissions. The primary conversation remains within reach. Team management is secondary under Team since [ADR 237](237-team-management-is-secondary-to-the-project-overview.md).
- Apps ask for the feature; an older server keeps the existing project home. No existing API changes shape.

## Alternatives

- Delete saved Boards or migrate their tiles into the overview: loses a working arrangement for no benefit.
- Hide a few controls but keep the configurable Board as the default: leaves the owner operating the same machinery.
- Ask a model to invent a status on every visit: slower and less trustworthy than the recorded work.

## Consequences

The default project view has one reading order. The saved Board remains an optional secondary view, including its arrangement, chart choices and card creation. Conversational setup, secondary Team management and consolidated updates remain later tickets.
