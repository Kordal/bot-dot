# ADR-092: A bot's machine on boat.dev takes a Vault secret for one command

- **Status:** Accepted (2026-10-26)
- **Owning task:** [#560](https://github.com/Kordal/bot-dot/issues/560)
- **Amends:** [ADR 088](088-a-bots-computer-may-be-a-machine-of-its-own-on-boat-dev.md)
- **Amended by:** [ADR 094](094-a-bots-machine-on-boat-dev-has-a-screen-and-a-browser.md) (typing a login on its screen)

## Context

ADR 088 put no Vault secret on a bot's boat.dev machine: `run_with_login`, `run_with_ssh_key` and `run_with_file` were refused there. A coding bot with a working GitHub login then could not push from its machine: `api_request` can't carry a commit of several megabytes, and the bot had no other way to hand the token to a command. The machine is the bot's alone, so the reason the account's computer warns about (every bot there has sudo, ADR 035) does not apply.

## Decision

- **The three Vault tools work on the bot's boat.dev machine**, with the rules they have on the account's computer: only entries shared with the bot, `run_with_login` only for logins marked "Usable in its computer", a GitHub App as its installation token, the answer blanked of every form of the secret. No new card or switch.
- **Never on a command line.** botdot writes the secret through boat.dev's file API to a file of its own in `/tmp` (`botdot-secret-*`); the command botdot sends reads it and removes it before the bot's command starts (a login, as `export` lines; an SSH key, loaded into an ssh-agent of that command, which ends with it), or removes it when the command ends (a file, at `BOTDOT_FILE` in a 0700 folder). The bot's command runs inside `timeout`, so the cleanup runs within boat.dev's own limit; botdot asks for the file to go once more after the command, and the next such command removes any older than 15 minutes.
- **Nowhere else.** When boat.dev can't start the machine, these calls are refused: the account's computer, which stands in for the bot's commands and files, never gets its secrets.
- **Still refused there:** `place_secret_file` (a secret kept on disk at boat.dev) and typing a login (no browser).

## Alternatives

- **The secret in the command's environment through boat.dev's command API.** Not used: the command text is what boat.dev's API is known to take, and it may keep it; a file through its file API is gone before the command runs.
- **A git credential helper on the machine answering from botdot**, as ADR 090 does for the server. Rejected for now: the machine can't reach botdot; `run_with_login` with git's `credential.helper` reading `$BOTDOT_PASSWORD` does the same for one command.

## Consequences

- A secret used there passes through boat.dev (EU) and sits on the bot's machine for the length of one command (a file) or less (a login, an SSH key in its agent). A command the bot writes can still copy it; this guards against leaks by accident only, as on the account's computer.
- An SSH key needs `ssh-agent` on the machine; without it the answer says to install `openssh-client`.
