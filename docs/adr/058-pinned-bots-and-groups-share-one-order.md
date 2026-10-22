# ADR-058: Pinned bots and groups share one order

- **Status:** Accepted (by the owner, 2026-10-22)
- **Owning task:** [#276](https://github.com/Kordal/bot-dot/issues/276)
- **Changes:** [ADR 018](018-a-group-is-a-chat-of-its-own-and-a-turn-is-a-run-of-its-member.md) ("A group's place is counted among the groups": now only `order`, not `pinned`)

## Context

A bot's `pinned` counted among the pinned bots and a group's among the pinned groups (ADR 018), so the Pinned page always showed every pinned bot, then every pinned group. The owner could not move a group above a bot, by dragging a row in the list or a key on the keypad.

## Decision

- **One sequence.** A bot's `pinned` and a group's count in one order: 1 is the first thing on the Pinned page below the Chief, bot or group. Pinning, moving, unpinning or deleting either kind numbers both again (`lib/pins.js`). A bot and a group never share a place; two that do (one file written before the other) sort the bot first.
- **Two files, one rule.** The bots stay in `bots.json` and the groups in `groups.json`. Each store asks `lib/pins.js` for the new places of both kinds and hands the other kind's to the other store, which saves only what changed.
- **Announced** as `pins-shared` in `features`. The web page is served by its own server and always uses it. Android uses it only from a server that announces it, and keeps "bots, then groups" against an older one.
- **Migration once.** On the first start, the pinned groups move behind the last pinned bot, so the page looks as it did. `pins.json` in the data folder (`{ "shared": 1 }`) marks that it was done.
- **Only the Pinned page.** In a category the bots still stand before the groups, and `order` is still counted per kind.

## Alternatives

- **A new field** (one shared place beside today's `pinned`). Keeps an older app's drag exact, but two numbers must then agree on every change, in two files. Rejected for its cost; the older app is replaced by the next APK.
- **One list of pinned keys in its own file.** Clean, but every reader of `pinned` (the apps, the Chief's tools, the list's sort) would need it as well. Rejected.
- **Mixing bots and groups in a category too.** Out of the ticket's scope.

## Consequences

- An app from before it sorts each kind by `pinned` and still shows every pinned one, the bots first. Its drag sends a place counted among its own kind, which the server now reads as a place in the one order, so the item can land a few places off on other devices until that app is updated.
- The Chief's `pinned` on a bot is a place among the pinned bots and groups.
