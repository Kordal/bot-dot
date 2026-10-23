# ADR-082: The admin chooses Haiku or Jev to pick who answers in a group

- **Status:** Accepted (asked for by the owner, 2026-10-23)
- **Owning task:** [#513](https://github.com/Kordal/bot-dot/issues/513)
- **Changes:** [ADR 081](081-a-short-model-call-picks-who-answers-a-group-message-without-a-mention.md) (the model that picks)

## Context

ADR 081 picks who answers a group message without a mention with one Claude Haiku call through Claude Code. On a staging machine, over the 30 messages of `scripts/group-router-bench.js`, Haiku took 2.7 s (median, up to 5.1 s) and once went past its 5 s limit. Jev (`typesafe/jev-1.14`, a decision model on OpenRouter) picked as well (the right member in 30 of 30, no needless one in 30 of 30) in 0.23 s. Jev is a hosted service: it needs an OpenRouter key, and every message it decides on goes to OpenRouter and TypeSafe.

## Decision

- **The admin chooses, for the whole machine, on the admin page: Haiku (the default) or Jev.** Choosing Jev asks for an OpenRouter key, checked with one small decision call before it is kept. Choosing Haiku drops the key. An account's owner has no such choice (AGENTS.md, rule 5: no new control).
- **The key is the front door's:** kept in `group-router.json` beside `front-door.json`, mode 600, and never answered (the page is told only whether one is set) or logged.
- **Each account's botdot server is handed the choice and the key** by the front door (`POST /api/group-router`, front door only), on a change and every minute, **and keeps them in memory alone**: never in its data folder, so never in an owner's backup, a log, the feed or an answer. One that started again routes with Haiku until it is handed them, within a minute.
- **Jev is asked one yes/no question per member and one "is it for everyone", in one request** (its `choice` gives a single option). A member is picked at 0.5 or more, the two likeliest; "for everyone", none sure or an answer missing gives every member the turn. The state holds the members' names, descriptions, main assignments and skills (cut), the last four lines and the message, as data. `data_collection: deny` is asked of OpenRouter.
- **Never silence, and Jev never makes it worse than Haiku:** when Jev fails, has no key or takes longer than 2 s, Haiku is asked as in ADR 081; when that fails too, every member has the turn. The message's `routed` records which one decided (`by`).

## Alternatives

- **Jev for everyone, with a key of botdot's own.** Rejected: botdot would hold a shared key and pay for every account, and every account's messages would leave the machine without its admin choosing it.
- **A choice per account.** Rejected for now: the key is the admin's, and the admin page is where the machine's outside services are chosen. It can be added if owners ask.
- **The account calls the front door, which calls Jev, so the key never reaches an account.** Rejected: today the front door reaches an account and not the other way, and a turn would wait on two hops. An account's server process holds the key in memory, out of every bot's reach (bots run as their own users).
- **Keep the key in the account's data folder, to survive a restart.** Rejected: it would go into the owner's backups.

## Consequences

- With Jev, a group message without a mention starts its first turn about 2.5 s sooner, and its text goes to OpenRouter and TypeSafe.
- A restarted account routes with Haiku for up to a minute.
- A refused or revoked key shows up as Haiku deciding (`by: "haiku"`), never as silence.
