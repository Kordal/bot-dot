# ADR-272: A usage limit holds only the runs on the connection that reached it

- **Status:** Accepted (spec in [#1668](https://github.com/ladrok/bot-dot/issues/1668)). Amends [ADR 267](267-several-providers-at-once-and-the-model-decides-which-one-runs.md), whose last consequence (the hold is the whole account's) it replaces, and [ADR 255](255-bots-can-run-on-another-model-provider-under-claude-code.md), whose line on the credential clearing the hold it extends to every connection.
- **Owning task:** [#1668](https://github.com/ladrok/bot-dot/issues/1668)
- **Builds on:** `claudeKey.routeFor(modelId)` (which connection a model runs on), `lib/settings.js`, `lib/bots.js` (the hold), [ADR 099](099-every-bot-run-has-an-outcome-in-a-ledger.md) and the usage-limit hold of #1090.

## Context

Since ADR 267 an account has the Claude connection (the subscription, or an Anthropic API key) and any number of saved providers at once, and each run already gets only its own connection's credential. The usage-limit hold stayed one value for the whole account (`limitUntil`), and so did the sign-out hold: when the Claude subscription reached its limit, runs on DeepSeek or GLM were held too, though their limits were not reached; a provider's rate limit would have held the bots on Claude. Saving or removing a provider changed no credential, so it never cleared the hold, and signing out of the subscription was decided by the account default's connection, not the run's.

## Decision

- **A hold belongs to a connection.** `lib/bots.js` keeps `limits`: connection → when its limit resets, where a connection is `claude` or a provider's preset, kept in `scheduler.json` (`limits`; a `limitUntil` from before is read as Claude's). The sign-out is the Claude connection's alone: a provider has no sign-in.
- **A run's connection is its model's.** `settings.connectionOf(model)` answers it from `claudeKey.routeFor`, the one place that already decides the run's arguments and environment. A bot's queue, its jobs, a message, a steer and a group's turn ask whether *that bot's connection* is held; the Chief asks about the connection of the Chief's model; a short helper call (the group router, the notes) asks about the account default's, as it already runs there. A limit is told by the run that hit it, to the connection it ran on.
- **A held run says which connection it waits for:** "DeepSeek's usage limit was reached: <bot> reads this once it resets." and, for a job, "DeepSeek's usage limit was reached." (Claude's words are as before.)
- **A different credential of a connection ends its hold, and no other's.** `claudeKey.credentials()` is one string per connection: the Claude connection's API key, and each provider's address and key. The setup's credential change compares them before and after, and clears the hold of each connection that changed, which includes a provider that was saved for the first time or removed.
- **Signing out decides by the connection.** `DELETE /api/setup/claude` is a plain sign-out (nothing stopped, nothing held) only when the Claude connection runs on an API key; otherwise it holds the Claude connection and stops the runs on Claude (`stopAllRuns('signout', 'claude')`), also when the account default is a provider. The scheduler's sign-in is the Claude connection's: an API key is signed in whatever the subscription is, the subscription is its own check, also while the account default is a provider.
- **API.** `connection-limits` in `features`. In `hello.claude` and the `claude` event `loggedIn` and `backAt` keep saying what the account default's connection waits for, so an app from before shows what it did; the new `held` lists every *other* held connection (`[{ connection, name, signedOut?, backAt? }]`), one line each in the apps ("DeepSeek's usage limit is reached: its bots carry on at 15:00"). An older app ignores `held`; iOS (shared data layer) reads it and ignores it until its screens catch up ([#1355](https://github.com/ladrok/bot-dot/issues/1355)). Settings shows no hold today, so it shows none now.

## Alternatives

- **One hold, cleared by any credential change.** What ADR 267 left: a limit on one connection stops the others, which is the bug.
- **A hold per bot.** A limit is the connection's fact, not a bot's: every bot on that connection would have to learn it separately, and the Chief and the helper calls have no bot.
- **Keep `held` complete, with the account default's connection too.** One list is simpler to draw, but `loggedIn` and `backAt` would repeat it, and every test and app that reads the shape of `claude` today would change; as an addition to them an older app is untouched.

## Consequences

- A bot on Claude waits for Claude's reset while its teammates on a provider go on; a group turn waits only for its member's connection, and the rest of the line waits behind it as for a busy member.
- The short helper calls (the group router, the notes) are held with the account default's connection, as they go on it; they are not stopped by another connection's limit.
- A restart keeps every connection's limit. A preset removed while limited loses its hold with the provider.
- A provider's own words for "rate limit" differ: only what Claude Code reports as a usage limit (`USAGE_LIMIT`) or its `rate_limit_event` marks a connection as limited, as for Claude.
