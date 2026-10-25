# ADR-090: A bot's AI run signs git in through botdot

- **Status:** Accepted (2026-10-25)
- **Owning task:** [#549](https://github.com/Kordal/bot-dot/issues/549)

## Context

A bot's Claude Code runs on the botdot server, as its bot's user. Its `git` there had no way to sign in: a private repository did not clone and a push failed. botdot's own ssh-agent (ADR 087) served script jobs only, and a GitHub App login (ADR 037) was usable only through `api_request`, or as a token in one command on the computer (`run_with_login`), which ends up written into a remote's URL. Bots worked around it through the GitHub connector and kept many copies of repositories.

## Decision

- **The run's own ssh-agent.** Every AI run of a bot but a memory review has `SSH_AUTH_SOCK` set to an ssh-agent botdot serves for that run (`lib/ssh-agent.js`, as ADR 087's): it offers every Vault SSH key shared with the bot, fetched from Bitwarden the first time ssh asks, and signs in the server's process. Sharing a key with a bot already lets it use the key (`run_with_ssh_key`), so the run asks for nothing more.
- **git's credential helper.** The run's environment sets git's configuration through `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n`: `credential.helper` is `lib/script-bin/botdot-git-credential`, and `core.sshCommand` accepts a new host's key (`StrictHostKeyChecking=accept-new`), so a first clone does not stop on a question nobody answers. Nothing is written in a repository's `.git/config` or the bot's home, and it ends with the run.
- **GitHub Apps only.** For `get` over HTTPS the helper asks botdot (`POST /api/vault/git/credential`, with `X-Run-Token: $BOTDOT_GIT`, a key of that run alone) and botdot answers the installation token of the first GitHub App login shared with the bot, by name, whose GitHub is that host (`github.com`, or a GitHub Enterprise Server by its address). Any other host, or no such login: nothing, and git goes on as without it. No other login, an API token included, is ever handed to git.
- **The key and the agent end with the run's process**, not with its reply: git may still be pushing as the reply comes.

## Alternatives

- **The token in the remote's URL** (`https://x-access-token:TOKEN@github.com/...`), as bots did on the computer. Rejected: it stays in `.git/config` after the token has expired, and is read by everything that reads the repository.
- **A personal access token (an API token login) for git as well.** Rejected: it lasts until the owner revokes it, and the run could read it; a GitHub App's token ends within the hour and opens only what the owner installed the app on.
- **Gating the token on "Usable in its computer".** Rejected: the token opens no more than `api_request` with that login already lets the bot do (GitHub's API writes files and branches too), so the switch would guard nothing and add a card.
- **OpenSSH's ssh-agent as the bot's user.** Rejected for the reasons of ADR 087.

## Consequences

- A run can read the token git is handed (`git credential fill`) for as long as the token lasts, at most an hour. It is that app's, for the repositories the app is installed on.
- A bot with several GitHub Apps for the same GitHub gets the first by name; an app installed on several accounts needs its installation ID in the Vault, as before (ADR 037).
- The computer and boat.dev are unchanged: their commands still use `run_with_ssh_key` and `run_with_login`.
- Keys of type DSA, or with a passphrase, can't be used, as for scripts.
