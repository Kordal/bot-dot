# ADR-097: A shared project is a folder on the account's computer

- **Status:** Accepted (2026-10-26, the owner's decision)
- **Owning task:** [#578](https://github.com/Kordal/bot-dot/issues/578)
- **Builds on:** [ADR 035](035-the-account-has-one-computer-all-its-bots-work-on-with-sudo.md)

## Context

Each bot has a folder of its own: its workspace on botdot, where it runs as a Linux user of its own, and `/workspace/<bot>` on the account's computer. The computer prompt tells a bot never to touch the others' files. The owner wants several bots to work on one project (a site, a repository, a set of documents) in one folder, and to set that folder up from the app.

## Decision

- **A project is a folder on the account's computer**, `/workspace/projects/<name>`, and the bots the owner put in it, kept in `data/projects.json`. Every bot there works as `box` (ADR 035), so they all read and write it with no new permission.
- **Only bots on the account's computer** can be in one. A bot on botdot alone or on boat.dev is refused: its files are on another disk.
- **The folder is made** as `box` when the project is made or changed while the computer runs, when a member's Workspace opens it, and at the first computer use of a member's run. The computer is never started for it. A link in place of the folder is left alone.
- **A member's prompt names its projects**, their folders and their other members, and says the files there are its and theirs: the one exception to "never touch their files".
- **The owner manages it from a member's Workspace**: a root of its own, managed as the bot's folder on the computer is (#576), with its bots and a delete. Deleting it deletes the folder with what it holds, after a confirmation that counts it, and only while the computer runs. A deleted bot leaves its projects; a project with no bot left stays until the owner deletes it.

## Alternatives

- **Projects on botdot's server too.** Rejected by the owner for now: each bot runs as a Linux user of its own there, so a shared folder needs a group per project in the privilege broker, with its own risks.
- **A link in each member's folder to the project.** Rejected: the Workspace never follows a link, and a bot's tools would see the files twice.
- **A Chief tool for projects.** Left for later: the owner makes them in the apps first.

## Consequences

- Two bots can change the same file at once; the prompt asks each to leave what a teammate is in the middle of, which is a convention, not a lock.
- A project's files are no one bot's: a bot's computer moving to boat.dev (ADR 091) does not take them.
- Renaming a project is not possible yet.
