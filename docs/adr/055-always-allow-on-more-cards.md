# ADR-055: "Always allow" on more cards

- **Status:** Accepted (by the owner, 2026-10-22)
- **Owning task:** [#280](https://github.com/Kordal/bot-dot/issues/280)
- **Changed by:** [ADR 066](066-a-task-the-chief-gives-a-bot-after-the-web-needs-no-card.md): a task the Chief gives a bot is not held; the bot's run starts as one that read the web
- **Partly superseded by:** [ADR 059](059-a-note-is-saved-without-an-ok.md) (a bot's shared notes need no card at all, so "Always allow for this bot" is gone)
- **Changes:** [ADR 033](033-the-chief-reads-the-web-and-what-it-changes-after-waits.md) (every change of the Chief's after the web waits) and [ADR 015](015-the-server-records-who-said-a-note.md) (every shared-note change after outside content waits)

## Context

The owner gets too many cards. A lasting answer existed only for connected-app actions (ADR 010, ADR 047), lifted rules (ADR 052) and jobs ("Always approve", which already covers a bot's later changes to its own approved job). The two most frequent cards had none: the Chief's changes after it read the web, which hold even a reminder, and a bot's shared-note changes after outside content, which a teammate's message or a file already triggers.

## Decision

- **The Chief: per type.** A held request of one of four types offers "Always allow <type>": a new reminder; a change to the Board (layout, a new or changed tile, a tile's value); the quiet hours; writing first. After that yes, a request of that type is done at once in a chat that read the web. The type list is in `lib/asks.js` (`AFTER_WEB_TYPES`), the grant in the settings (`chiefAfterWeb`).
- **A Board change that reaches out is no such type.** An http read sends a request with what the Chief wrote in it, so a request whose body names an address or a saved login anywhere is held as before and never offered "always". A script still waits on the tile's own card.
- **Never offered:** a removal, a bot's task, a bot, a job, a skill, an SSH key, the checkup (it can switch web search on), anything that sends outside, and the cards the Chief asks for by name (a reset).
- **The Chief lists and removes its types by chat** (`after_web_grants`, `remove_after_web_grant`), as its connector grants (ADR 047). Only the owner's card adds one. No new control in the apps (AGENTS.md rule 5).
- **A bot: its shared notes.** A card of a bot's addition or change to the shared notes offers "Always allow for this bot". After it, that bot's additions and changes there are saved at once, still marked "after outside content". Its removals, a change to what the owner said (guarded) and a forget still wait. The flag `sharedNotesAlways` is set through a symbol no request body reaches, as `overrides` (ADR 052); the owner revokes it in the bot's settings under "Always approved".
- **Every always and every revoke is in the audit log**, with the type or the bot, never a text.
- **Vault cards are untouched.**

## Alternatives

- **A narrower Chief rule for everyone** (hold only what is risky after the web). Considered in the same review; the owner chose not to take it now. "Always allow" keeps the default safe and lets the owner open one type at a time.
- **One "trusted" level per bot.** Too wide: one page read by such a bot acts unasked.
- **Always allow Board changes whatever they hold.** An http read is a way to send the owner's data to any address.

## Consequences

- A Chief that read a page with instructions can set reminders or arrange the Board unasked once the owner allowed that type; it can send nothing out through it.
- A bot the owner trusts with shared notes can write what a page told it into every bot's memory; the note says "after outside content", and the owner can revoke.
- An app from before shows no second yes; its cards work as before.
