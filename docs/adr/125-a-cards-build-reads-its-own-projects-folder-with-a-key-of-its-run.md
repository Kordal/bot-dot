# ADR-125: A card's build reads its own project's folder, with a key of its run

- **Status:** Accepted (2026-10-30)
- **Builds on:** [ADR 123](123-a-card-on-a-projects-board-is-built-and-kept-fresh-by-a-run-of-the-chiefs.md) (a card is built by a run of the Chief's), [ADR 122](122-a-projects-folder-is-on-the-accounts-computer-and-reached-over-botdot-without-it.md) (each project has its own folder on the account's computer)

## Context

A card about the project's own work ("How far is the website?") failed: its build had the web and the owner's apps, but not the project's folder, where the project's bots keep their drafts and files (ADR 122, #772). Each project already has a folder of its own; the build just could not reach it. Giving it botdot's reading tools would let it read every project, and the bots' project file tools take a project as an argument.

## Decision

- **Every card build gets two tools of botdot: `list_project_files` and `read_project_file`,** on the folder of the card's project, read-only. Nothing that writes, and no other tool of botdot.
- **The project is named by a key of the run, never by the run itself.** botdot makes a fresh key for each build (`lib/routes/company.js`), hands it to the run's tools server (`BOT_DOT_CARD`), and answers `GET /api/company/card-files` only with the key of the build going on now; the key names the project, and no tool takes one. The key ends with the run. So a card reads its own project's folder and no other's, whatever a page or a file it read tells it.
- The folder is read from botdot's own seat on the account's computer, as the bots' bridge tools do (ADR 122), and the computer is started when it is off.

## Alternatives

- **botdot's reading tools in the build:** they read every bot and run, not one project.
- **The bots' project file tools:** they write, copy and delete, and take a project by name.
- **A copy of the folder handed in the prompt:** stale, large, and a binary file has no place in it.

## Consequences

- A card that reads the folder starts the account's computer when it is off.
- Only text files are read (up to 100,000 characters, as a bot's `read_project_file`).
