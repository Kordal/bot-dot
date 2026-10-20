# ADR-037: A GitHub App's key stays in botdot, which hands out its tokens

- **Status:** Accepted (2026-10-20, the owner's decision on [#155](https://github.com/Kordal/bot-dot/issues/155): "A+B")
- **Owning task:** [#155](https://github.com/Kordal/bot-dot/issues/155)

## Context

A bot needs a GitHub App's private key (`kordal-issue-writer`) to sign a JWT and exchange it for an installation token. The Vault had no way to take a key of several lines: its secret was a one-line password field, which loses the line breaks of a pasted `.pem`. And a key handed to the bot's computer would be readable by every bot there (ADR 035), while the output of a command there is blanked out by accident only.

## Decision

- **A secret of several lines.** The Vault's "Other" type, and the new GitHub App type, take their secret in a masked box of several lines on the web page and in Android, pasted or read from a picked file (64 KB at most). The server keeps it as it is, line breaks too, in the built-in vault and in Bitwarden's login `password`. Nothing else changes: an Other secret is used as any other.
- **A GitHub App type** (`github-app`, announced as `vault-github-app`): its App ID in `username`, with `/installation ID` after it when the app is installed on several accounts, and its private key as the secret; the address starts as `api.github.com`. A save is refused unless the App ID is a number and the key is an RSA private key Node's crypto reads.
- **The key never leaves botdot.** Wherever a login's secret goes, a GitHub App gives an installation token instead (`lib/github-app.js`): `api_request` and a Board tile fill `{{token}}`/`{{password}}` with it, and `run_with_login` hands it in `BOTDOT_PASSWORD`, with `x-access-token` as the username, as git over HTTPS takes it. botdot signs the JWT itself, finds the installation (the one written, or the app's only one), and keeps the token until five minutes before GitHub's expiry. Typing a GitHub App into a browser is refused.

## Alternatives

- The key as a temporary file, mode 600, in the bot's computer (the issue's option 1): rejected. It breaks "never a secret in a file" (SECURITY.md), and the bot's command could print the key.
- A Bitwarden attachment (option 2): the same exposure, and a second way of storing secrets.
- An Installation ID field of its own: one more field for a case one app rarely has; the slash after the App ID covers it, and an error names the installations when it is missing.

## Consequences

- A bot that leaks its token leaks access for at most an hour, to what the app's installation allows; the key is not exposed.
- The token is still readable by every bot on the account's computer while a `run_with_login` command runs, as any secret used there.
- A changed key is used at once: the cache is keyed by the key's hash.
- Issue #157 (file secrets) can reuse the box of several lines.
