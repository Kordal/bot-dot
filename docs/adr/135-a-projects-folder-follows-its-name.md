# ADR-135: A project's folder follows its name

- **Status:** Accepted
- **Owning task:** [#865](https://github.com/Kordal/bot-dot/issues/865)
- **Amends:** [ADR 097](097-a-shared-project-is-a-folder-on-the-accounts-computer.md), [ADR 122](122-a-projects-folder-is-on-the-accounts-computer-and-reached-over-botdot-without-it.md)

## Context

ADR 122 names a project's folder once, from the project's name when the folder is first asked for, and keeps it when the project is renamed, since ADR 097 never renames a folder. Since #859 the owner names a project before its folder is made, and expects the folder to carry the name. After a rename, the Folder row of the project's settings and every bot's prompt still show the old one.

## Decision

- **The folder follows the project's name**, by the rules it was made with: a `/`, `\`, `<` or `>` becomes a space, a leading dot goes, and a name taken in `data/projects.json` or on the computer's disk gets " (2)", " (3)"... A folder whose name is the one the project gives, or that name with " (n)", is left as it is.
- **Only when nothing uses the path.** A bot of the project on the account's computer has the folder's path in its prompt for the whole run. The folder is renamed when no bot of the project's teams runs, and only while the account's computer runs: it is never started for this. Until then it keeps its name. `PATCH /api/company` with a new `name` tries at once; a sweep tries every minute after.
- **Computer first, list after.** botdot moves the folder on the computer as `box` (`mv -T`, never over anything), then renames it in `data/projects.json`. When the list cannot follow (the project was renamed or gone meanwhile, or the name taken), the folder is moved back. A folder not made yet is renamed in the list alone.
- **One place to rename.** The folder is on the account's computer on this machine also when the account's computer is the External Virtual PC (ADR 098): the `projects` seat never goes to boat.dev, and the bots there reach it with the project file tools. Everything that names the folder reads it from the list at each use (prompts, project file tools, a card's files, Files, the settings), so nothing else is rewritten.

## Alternatives

- **Rename at once, running bots or not.** Rejected: a running bot's next command on the old path fails or makes an empty folder there.
- **Block the project's rename while a bot runs.** Rejected: the name is the owner's, and the folder can wait.
- **A link from the old name to the new.** Rejected: the Workspace never follows a link (ADR 097), and the old name would stay taken.

## Consequences

- A project renamed while its bots work has its folder renamed up to a minute after they stop.
- A file mention written before the rename names the old folder and shows as gone.
- A project renamed before this change gets its folder renamed on the first sweep after the update.
