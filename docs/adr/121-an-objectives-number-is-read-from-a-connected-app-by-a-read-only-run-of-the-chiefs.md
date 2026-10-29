# ADR-121: An objective's number is read from a connected app by a read-only run of the Chief's

- **Status:** Accepted (2026-10-29)
- **Owning task:** [#699](https://github.com/Kordal/bot-dot/issues/699), spec [#687](https://github.com/Kordal/bot-dot/issues/687)

## Context

A project's objectives are numbers (ADR 110, #690) that the owner or the Chief sets by hand. Many of them live in an app the owner already connected (active subscriptions in Stripe, weekly users in Google Analytics), so the number is stale the day nobody types it. The owner wants such a number to update itself, see when it last did, and hear once when it can't.

## Decision

- **An objective has a `source`:** `{ app, what, every }`, the slug of a connected app, what to read there in the owner's words, and `daily` (default) or `weekly`. The owner sets it on the goal card or tells the Chief, whose `set_company_objective` takes `source`; `null` stops it.
- **A run of the Chief's own reads it**, as a scheduled job of the Chief's does (ADR 073): no chat, the one app named, read-only (every action that is not a plain read is refused, ADR 070), no web and no tool that changes botdot. It answers the number alone on its last line, or `FAILED: why`. The server parses the number and sets `current` as `set_company_objective` would (kept in `history`). The run cannot write to the project at all: the number is the only thing it hands back.
- **When:** while the project runs, a day (a week) after the source's last try, checked every five minutes, one read at a time and never beside a look, a job or a page's run (the next round tries again). A new or changed source is read at once.
- **Kept on the source:** `readAt` (last read that gave a number, drawn on the card), `triedAt`, and `failed` (why the last try gave none). The first failure since the source last worked is said once, as botdot's line in the Chief's chat with no AI turn; later failures only show on the card until a read works again.

## Alternatives

- **A bot job per objective calling `set_company_objective`.** Rejected: it needs a bot with the app given to it and an approval card per job, and it could write anything to the project; a read that hands back one number is all this needs.
- **Letting the run call `set_company_objective` itself.** Rejected: a write tool in a run that reads an app's data (untrusted) could be steered to change other objectives.
- **Calling a fixed app action without Claude.** Rejected: each app names its actions and fields differently, and the owner says what to read in words.
- **Saying every failure.** Rejected: the issue asks for once; a broken source would write daily.

## Consequences

- A source costs one short Claude run a day (a week) per objective, at most six per project.
- A disconnected app fails at once, without a run, and is said once.
