# ADR-269: Every bot may be in shared rooms

- **Status:** Accepted (2026-11-24, the owner asked for it)
- **Owning task:** [#1673](https://github.com/ladrok/bot-dot/issues/1673)
- **Amends:** [ADR 060](060-a-shared-room-lets-bots-of-several-accounts-talk-through-the-front-door.md) (a bot's `rooms.allowRooms`, off until its owner turned it on)
- **Follows:** [ADR 192](192-every-bot-has-the-web-files-a-computer-and-every-other-bot.md), which made the web, files, a computer and messaging the same for every bot
- **Builds on:** [ADR 067](067-the-owners-mention-in-a-room-runs-the-bot-with-every-step-on-a-card.md) (the owner's mention in a room runs the bot, every step on a card)

## Context

Under ADR 060 a bot was out of shared rooms until its owner switched "May be in shared rooms" on in its settings. The owner never wanted a bot kept out: the switch was one more thing to find before a room was any use, and the front door's refusal ("Turn Rooms on in its settings first") sent people back to look for it. The owner asked to drop it, as ADR 192 dropped the other per-bot switches.

## Decision

- **Every bot has `rooms.allowRooms: true`, always.** The server gives it whenever it reads the bots and on every save (`lib/room-settings.js`, `roomsAfter`): a bot saved with `false` reads back `true`, and a `PUT` of `false` is accepted and keeps it `true`. No owner's, Chief's or bot's change turns it off. The key stays in the object for an app on an older server, which shows whatever its server sends.
- **No switch.** The web page and the Android app no longer draw "Shared rooms" / "May be in shared rooms". **"Who may mention it"** (only you / anyone in the room) stays, a separate safety choice, and shows whenever room settings show. The copy that told people to switch the bot on is gone: the Android hint "None of your bots may be in shared rooms yet", and the web page's "once Shared rooms is on in their settings". The front door's 404 for a missing bot is now a plain "You have no such bot."; its 403 "is kept out of rooms. Turn "Rooms" on in its settings first." stays, as only an account server older than `rooms-every-bot` can produce it.
- **The server says so: feature `rooms-every-bot`.** The Android app drops the switch and the hint only when `features` has it; against an older server, where a bot may still have `allowRooms: false`, it draws "May be in shared rooms" (with "Who may mention it" only while it is on) and the hint as before, so an owner can still let a bot in. The web page is served by the server and needs no gate.
- **The admin's switch stays.** A room exists only where the machine's admin turned Shared rooms on (ADR 060), and never on a machine of one account.
- **What a mention does is unchanged.** Mentioned by anyone but its owner a bot only talks; mentioned by its owner, every tool call and every post waits on the owner's card (ADR 067).
- **The iOS app** still draws the old switch until it catches up ([#1355](https://github.com/ladrok/bot-dot/issues/1355), ADR 242); against a new server it changes nothing.

## Trade-off

- **Any bot can be put in a room, and the people there can reach it.** Each person adds only their own bots (ADR 060), so a bot is in a room only after its owner adds it, in the room's settings. But the owner no longer has a setting that says "this bot never goes into a room": once it is added, the people of other accounts in that room can reach it, within "Who may mention it" (only its owner by default) and the owner's cards. What stands between them and the bot: the default "only you", the talk-only turn for a mention by anyone else (no tools, notes, files or private chats), the owner's card for every tool call and post of their own mention (ADR 067), and the admin's switch for the whole machine.
- **Where the owner chose "anyone in the room", a room member's mention gets a turn from the bot** and costs the owner's Claude use as before (ADR 060: no daily limit); the default avoids it.
- **An owner can no longer keep one bot out by a setting.** A bot that must never be in a room is kept out by not adding it, or everywhere by the admin turning rooms off for the machine.
- **A bot already in a room cannot be told "stay out" later**; the owner takes it out of the room (Remove) instead.

## Alternatives

- **Keep the switch, default on:** an owner could still keep a bot out, but it stays a switch to find and a state to explain, and the owner asked to drop it.
- **A per-bot "never in rooms" kept for the admin or by chat:** more surface for a setting the owner does not want.
