# ADR-085: A script job calls APIs with the logins its job lists

- **Status:** Accepted (2026-10-24)
- **Owning task:** [#523](https://github.com/Kordal/bot-dot/issues/523)

## Context

A script job runs without AI: fast, and free of model use. Until now a script could not use a saved login, and the prompt said so ("Scripts can't use Vault logins"). So the Chief kept routines that only count or check behind a saved token (open issues on GitHub, a daily health check, the numbers for a page, an infra review over an API) as AI jobs: a run of Claude each time, to read a few numbers. botdot already sends requests with a saved login for others without handing out the secret: a bot's `api_request` and a Board tile's `http` source (`lib/vault-http.js`). The rule that bots never read a stored value stands (ADR 035).

## Decision

- **A script job lists its logins** (`logins`, up to 8, as `api_request` and `run_with_login` take, #228), each a login shared with its bot. Only a script job has them.
- **The owner approves them with the script**, on the same card. Whoever but the owner asks, a login the approved job does not have waits for the owner's OK, also on a job they always approve: like a call or a notify address, a new login is never approved by trust given to earlier changes. A login taken away is a change like any other.
- **The script calls `botdot-request`**, a command on its `PATH` (`lib/script-bin/botdot-request`). It asks botdot's own port, and botdot makes the request through `vault-http` as for `api_request`: values in headers only, to the login's own host or its approved hosts, and the secret blanked out of the answer.
- **One key per run.** A run of a job that lists logins gets a random key (`BOTDOT_RUN`) that lets in only that bot's user (the gate, `server.js`), only for that job's logins, and is gone when the script ends. A job without logins gets none.
- **No value in the environment or a file.** `run_with_login` puts values in `BOTDOT_<NAME>_PASSWORD` for programs that need them; a script job never gets that.

## Alternatives

- **Values in environment variables, as `run_with_login` does.** Rejected: a script can print or send them, and every program it starts inherits them.
- **A file with the token for the run.** Rejected for the same reason, and a file outlives a script that is killed.
- **Approve each login once for every script of the bot.** Rejected: the owner reads one script and what it may use together, on one card.

## Consequences

- The Chief and the bots are told to make routines that only count or check script jobs with logins and `aiWhen: "output"`, and to propose that for an AI job that does only that: the AI is called only when the script printed something.
- A script can still send what an API answered elsewhere. The owner reads the script before it runs, and again when it changes.
- SSH from the Vault for scripts is not part of this: the server's image has no SSH client yet, and it is its own ticket.
