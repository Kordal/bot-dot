# ADR-117: An account has several projects, kept as a list in one file

- **Status:** Accepted (2026-10-29)
- **Owning task:** [#689](https://github.com/Kordal/bot-dot/issues/689), spec [#687](https://github.com/Kordal/bot-dot/issues/687)
- **Supersedes:** the "one company per account" part of [ADR 110](110-a-company-is-a-place-of-its-own-with-teams-that-each-have-one-lead.md)

## Context

ADR 110 kept one company per account and deferred a list, keeping an `id` on the record for it. After testing on staging the owner wants the place renamed Projects (#688) and several projects in it: PROJECTS in the left column with "+", each a tree of its teams and bots, switching between them, and on a phone the project's name as a dropdown. Every other ticket of #687 stores its data inside the project's record.

## Decision

- **A list of the same records.** `data/company.json` holds the one record while the account has one project, exactly as before, and `{ projects: [record, …] }` once it has more, in the order they were made. The company there was is the first project after the update; nothing moves. A record gains `color`, the colour of its letter in the tree (one the others do not have; an older record gets one from its id).
- **Every route names its project.** Each `/api/company…` route takes `?project=<id>`, and without it acts on the first project, so an older app keeps working on the first one. `POST /api/company` makes a new project after the others (no longer `409` for a second). `GET /api/company/list` answers them all. `features` has `projects-many`. `/api/projects` stays the shared folders of ADR 097.
- **Two feed events.** `project` `{ id, project }` for any project (`null` once deleted), for the apps that know `projects-many`; `company` `{ company }` keeps carrying the first project, sent when it changes or another becomes the first, so an older app is never handed a second project as its company.
- **A bot is in at most one team of each project**, and may be in teams of several projects. A deleted bot leaves its teams in every project.
- **The Chief is told every project with its id**, and each company tool takes an optional `project` (left out: the first). A held change of the Chief's (after it read the web) keeps its query, so the owner's yes does it to the project it was asked of.
- **A bot on teams of several projects** is told its team and its to-dos in each (ADR 114, ADR 115), and its to-do tools take `project` (the project's name or id), needed only when it is on teams of more than one.
- **Which project is shown is the device's**, like Bots or Projects (ADR 110): the server has no "current" project.

## Alternatives

- **A file per project** (`data/projects/<id>.json`). Rejected: one file keeps a single read and write per change and lets an older server still read an account with one project.
- **`/api/company/<id>/…` paths.** Rejected: every route and the Chief's allowed routes would change shape; a query keeps the paths and older apps as they are.
- **One feed event carrying any project.** Rejected: an older app would show whichever project changed last as its company.
- **A bot in one team across all projects.** Rejected: the owner reuses a good bot in several projects; the rule that matters (one lead per team, one team per bot) holds within a project.

## Consequences

- An account with several projects rolled back to an older server shows no company until it has one project again; its data stays in the file.
- The web page keeps a list of projects and remembers the one shown per device; Android follows in #703.
