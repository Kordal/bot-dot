# ADR-084: A principal's tree that is already its own is not walked on each start

- **Status:** Accepted (2026-10-23)
- **Owning task:** [#521](https://github.com/Kordal/bot-dot/issues/521)

## Context

Before the botdot server starts, the privilege supervisor (`lib/privilege-broker.js`, `migrate()`) sets the owner and mode of the account's data. For the Chief and each bot, it walked `homes/<who>` and `workspaces/<who>` to the end on every start: open, fstat, fchown and fchmod on every file. On one account, a bot's workspace held about 2.1 million files (git worktrees and repository copies). Under gVisor that walk took about 5 minutes before the server's first log line, so every update rolled the account back (#519).

## Decision

- **A principal's tree is walked to its end only while its own folder isn't the principal's** (uid, and gid: the Chief's for a bot's workspace). Otherwise only that folder's owner and mode are set again.
- **Why that is enough:** `ownTree` sets a folder after everything inside it. So a folder owned by the principal means a walk reached its end, and one that stopped halfway leaves the folder for the next start to finish. After that, only the principal writes inside its tree (`0700`, or `0750` for the Chief's reading). Skipping the walk changes nothing, so it can't give a principal a file it didn't own.
- **What still gets the full walk:** data from before principals existed, a restore (written by the server, so its folders are the server's), and a principal whose uid changed. Each of these has a folder with the wrong owner.
- The server's own data and `skill-packs` keep their full walk on each start: they are small.

## Alternatives

- **A stamp file saying a full migration has run.** Rejected: the server owns the data folder and could write or remove it. The folder's own owner says the same per tree, and only root can set it.
- **Walk in the background after the server starts.** Rejected: a principal could run before its tree is set.

## Consequences

- An account starts in about the same time whatever its bots' workspaces hold.
- A file a bot makes with "other" permission bits inside its own tree keeps them: the tree's `0700`/`0750` folder already keeps everyone else out.
