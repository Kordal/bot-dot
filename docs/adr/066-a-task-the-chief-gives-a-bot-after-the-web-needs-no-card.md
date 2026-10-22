# ADR-066: A task the Chief gives a bot after the web needs no card

- **Status:** Accepted (by the owner, 2026-10-22)
- **Owning task:** [#373](https://github.com/Kordal/bot-dot/issues/373)
- **Changes:** [ADR 033](033-the-chief-reads-the-web-and-what-it-changes-after-waits.md) (every change of the Chief's after the web waits) and [ADR 055](055-always-allow-on-more-cards.md) (a bot's task is never always allowed)

## Context

In a Chief chat that read the web, "Give <bot> a task" (`run_bot`, `POST /api/bots/:id/run`) waited on a `chief-action` card. The owner does not want a card when one bot hands work to another: a bot messaging a teammate or a group turn already needs none (ADR 020), and the Chief's hand-off was the one path that asked. The card guarded against a page telling the Chief to make a bot do something; the bot itself has its own guards.

## Decision

- **Not held.** `bots/:id/run` joins the routes that are free after the web (`FREE_AFTER_WEB` in `server.js`). The bot starts, or the task waits its turn, at once.
- **The run starts as one that read the web.** The task's words may be a page's, so the bot's run has `"web"` in `outside` and `readOutside` from its first moment, as a teammate's hand-off starts with `"teammate"` (ADR 015, ADR 020). A note it saves is "after outside content", a removal from the shared memory or a forget waits, a skill it writes waits, and every card a bot gets in any run (a connected-app write, the Vault, a permission, a webhook, a call) still holds. A task queued behind a busy bot keeps the mark on its queue entry until it starts.
- **Everything else stays held.** Making, changing or deleting a bot, a job and its run, a skill, the Board, a group, a reminder, settings: as ADR 033 and ADR 055 say.
- **The Chief is told** in its instructions that `run_bot` does not wait, and to hand on only what the owner asked for, never a page's instructions.
- A card for a task held before this change still works: its yes does the request, as before.

## Alternatives

- **Hold only a task whose words came from the page.** botdot cannot tell which words the Chief took from a page; a check on the text would be a guess and give no guarantee.
- **"Always allow" for a bot's task** (ADR 055's way). Still one card per kind first; the owner asked for none.
- **Keep the card for a bot with risky access** (Vault logins, connected apps, the computer). Those are guarded in the bot's run by their own cards already; a second card in front of them adds a tap and no new check.

## Consequences

- A page that persuades the Chief can start a bot with a task. That bot can do what it does unasked in any run: its commands and its folder, reading the web, messaging teammates. What reaches outside the account through a guarded route still waits on its card, as for a bot that read the page itself.
- What such a run saves to memory is marked as outside content and is the first to leave the pinned notes.
