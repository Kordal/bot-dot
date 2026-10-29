# ADR-122: A project's folder is on the account's computer, and reached over botdot by a bot without it

- **Status:** Accepted (2026-10-29)
- **Owning task:** [#702](https://github.com/Kordal/bot-dot/issues/702), spec [#687](https://github.com/Kordal/bot-dot/issues/687)
- **Builds on:** [ADR 097](097-a-shared-project-is-a-folder-on-the-accounts-computer.md), [ADR 120](120-an-account-has-several-projects-kept-as-a-list-in-one-file.md)

## Context

A project of the Projects place (ADR 120) has teams of bots, but no place for its files. ADR 097 gives a shared folder on the account's computer, `/workspace/projects/<name>`, to bots that work there. A project's bots may also work on botdot alone or on boat.dev, where that folder is on another disk. The ticket asks to decide between a bridge (file tools over the server) and a mirror (a copy kept in step).

## Decision

- **Every project has one folder, ADR 097's:** an entry of `data/projects.json` with `project`, the project's id. It is named as the project was when the folder was first asked for (a `/`, `\`, `<` or `>` becomes a space; a name taken gets " (2)") and keeps its name when the project is renamed, since a folder is not renamed (ADR 097). Its bots are every bot of the project's teams, read at each call, whichever computer each uses; they change with the teams, not in a bot's Files (`409` `{ state: "linked" }`). An older project gets its folder the first time it is shown.
- **A bridge, not a mirror.** A bot on the account's computer works in the folder with its own tools there. Any other bot of the project gets six tools, `list_project_files`, `read_project_file`, `write_project_file`, `copy_to_project`, `copy_from_project` and `remove_project_file`, which botdot runs on the account's computer as box, with the fixed scripts of `lib/workspace-files.js` (paths relative to the folder, never through a link). The copies carry any file, byte for byte, between the folder and the bot's own workspace.
- **One seat of botdot's own, `projects`,** makes those calls, and the owner's: never the bot's, whose calls would go to its own machine on boat.dev. Its screen number is never started.
- **The computer starts for it** when a bot's tool or the owner's Files needs it and it is off, as a bot's first computer tool starts it (ADR 035). ADR 097's rule that nothing starts the computer for a shared project still holds for those the owner makes by hand.
- **Each bot of the project is told the folder** in its team note (ADR 114): its path, on its own computer or reached with the project file tools. ADR 097's "Shared projects" note leaves a project's folder out, so it is said once. The bound test of a bot's prompt with every cap hit grows to 126,500 characters (126,081 measured), as in ADR 114 a check of the caps, not a hard limit.
- **The owner opens it** from the project's settings, the Folder row, in the same Files as a bot's, alone: `/api/projects/<name>/workspace…`, the routes of a bot's Workspace with the folder as its one place.
- **Deleting the project asks** whether the folder stays. `DELETE /api/company?folder=delete` deletes it with what it holds; without it, as an older app deletes, the folder stays, a shared project of ADR 097's from then on with the bots of the project's teams that use the account's computer.

## Alternatives

- **A mirror in each bot's workspace on botdot.** Rejected: two copies of every file and a sync at each run, with two bots changing the same file in two places and no way to say which wins; a bot would see the files twice, the reason ADR 097 refused links.
- **The folder on botdot's server.** Rejected for the reason ADR 097 gives: each bot is a Linux user of its own there, so a shared folder needs a group per project in the privilege broker.
- **The bot's own seat for its bridge calls.** Rejected: a boat.dev bot's calls go to its machine there, and a bot without a computer would take a screen number for nothing.

## Consequences

- A bot without the computer reaches the folder only with the project file tools, not with Read or Write; what it needs to change with its own tools it copies into its workspace and back.
- An account whose bots use none of the computer starts it the first time a project's folder is used.
- Android shows no Folder row yet: its project settings follow in their own ticket.
