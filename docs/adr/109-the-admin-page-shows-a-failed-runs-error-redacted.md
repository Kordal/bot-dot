# ADR-109: The admin page shows a failed run's error, redacted

- **Status:** Accepted (2026-10-28)
- **Owning task:** [#662](https://github.com/Kordal/bot-dot/issues/662)
- **Amends:** [ADR 099](099-every-bot-run-has-an-outcome-in-a-ledger.md), [ADR 105](105-the-admin-page-counts-how-accounts-use-botdot.md)

## Context

The admin page lists each failed run of an account by its error kind (#615). On a live machine most of them are "Other error" or "Claude Code exited": kinds botdot couldn't name. The ledger kept no error text (ADR 099), so finding out what went wrong took SSH and a run file.

## Decision

- **One line, redacted.** When a run fails, its ledger row keeps `detail`: the line of its error that names the problem (else the last), with every URL, email, path, IP address, UUID or hex id, number of 5 digits or more, token-like string of 24 characters or more, quoted text (a lowercase name of a thing, such as a JSON key or `error_during_execution`, stays), and the value after `token`, `secret`, `password`, `api_key`, `authorization`, `bearer` or `cookie` replaced by a placeholder, then cut to 160 characters (`lib/error-detail.js`). A restart keeps none: its error is botdot's own.
- **Both sides redact.** The account hands `detail` with each failed run in the usage summary; the front door runs the same redaction again before it keeps it in `usage.json`.
- **Rows from before.** On start, a failed run of the last 7 days without a detail gets it from its run file, once; the front door asks again for a recent day whose failed runs were kept without it.
- **Shown on click.** On the admin page, a failed run with a detail opens it in a line under its row.

## Alternatives

- **More error kinds alone.** Kept doing (#615 added six), but there is always a rest that only its text explains.
- **The raw error, or its last lines.** Rejected: stderr and Claude Code's error result can quote what the run read, and the admin may not be the account's owner (ADR 028).
- **Fetch the line live, on click, from the account.** Rejected: the front door holds no run ids, and a day's failures would need the account running to be read.

## Consequences

- ADR 099's "no error message" and ADR 105's "no text" now have this one exception: a redacted line of a failed run's error, for the admin page alone. The bots' own ledger API is unchanged.
- An error's free words stay. A name written without quotes in an error can reach the admin page; the redaction removes what is shaped like an address, a path, a quote, an id or a secret, not every word.
