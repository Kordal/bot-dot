# ADR-261: A bot may have a place for its computer of its own, under Advanced

- **Status:** Accepted (2026-11-23, the owner's decision on [#1613](https://github.com/ladrok/bot-dot/issues/1613))
- **Owning task:** [#1613](https://github.com/ladrok/bot-dot/issues/1613)
- **Amends:** [ADR 098](098-the-accounts-computer-is-in-one-place-for-all-its-bots.md) (the account's computer is in one place for all its bots), [ADR 146](146-only-the-admin-moves-an-accounts-computer.md) (only the admin moves the account's)
- **Builds on:** [ADR 088](088-a-bots-computer-may-be-a-machine-of-its-own-on-boat-dev.md) (the per-bot choice this brings back, without its own machine), [ADR 091](091-a-bots-files-are-copied-when-its-computer-moves.md), [ADR 096](096-the-accounts-boat-bots-share-one-machine-there.md), [ADR 171](171-a-bots-browser-goes-out-through-the-accounts-proxy.md), [ADR 200](200-advanced-shows-the-technical-rows-and-starts-off-for-a-new-account.md)
- **Amended by:** [ADR 263](263-an-account-may-use-its-own-boat-dev-key-with-one-machine-for-all-or-one-per-bot.md) (a bot's place may also be a machine of its own on the External Virtual PC)

## Context

Since ADR 098 the account's computer is in one place for all its bots, this machine (`linux`) or its machine on boat.dev, the External Virtual PC (`boat`), and since ADR 146 only the admin (on a managed machine, the fleet console, ADR 154) moves it. That is right as the default: most owners want one team on one computer. But an owner who has the External Virtual PC wants one bot there, for builds or a clean machine, while the others stay on this machine, or the reverse. ADR 098 rejected the per-bot choice because per-bot places "split one team over two computers"; the owner now wants it back for those who ask for it, without the first reason to remove it: no price, no sizes, no machine per bot.

## Decision

- **A bot has a place of its own:** `bot.computerPlace` is `''` (it follows the account's place, the default), `linux` or `boat`. Existing bots get `''`: nothing moves on upgrade. `bot.computer` stays what it was, where the bot works now, `none`, `linux` or `boat`: it is the bot's own place when it has one, else the account's. Every place that asks where a bot's computer is (the computer tools, its screen, uploads and replays, the end of a run, the computer card, the proxy) reads `computer` and so follows the choice.
- **The account's place stays the default,** moved only by the admin or the console as ADR 146 has it. An account-wide move moves the bots that follow the account and leaves a bot with a place of its own where it is. Before the admin has chosen, the account's place is inferred (ADR 098's upgrade rule) from the bots that follow the account only.
- **The owner decides, in the bot's settings, with Advanced on** (ADR 200, hidden with it off, never dropped). The Chief does not move a bot's computer, and `403` answers a change of `computerPlace` from the Chief or from a bot, however it was approved (as ADR 098 has it for the account's).
- **On the External Virtual PC a bot uses the account's one machine** (ADR 096), in its own folder. There is no machine of its own per bot: `boatOwnMachine` stays gone (ADR 098).
- **Moving one bot copies its files as ADR 091 says:** the apps ask once "Copy files" or "Start empty" (`moveFiles`) when its place changes where it works, `''` counting as the account's place now; the copy runs in the background and a change of its computer waits while a copy runs (`409`).
- **The External Virtual PC is offered only where it can run:** boat.dev has a key on this machine (`boatReady`). Without one the server refuses `computerPlace: "boat"` (`400`) and the apps do not show the choice. A bot already there keeps the row, so its owner can bring it back.
- **The proxy follows the bot's place (ADR 171, unchanged):** on this machine the bot's own proxy choice applies; on boat.dev the account's, one browser for the machine.
- **No prices or sizes** in the apps (AGENTS.md rule 5): the choice reads "Account's choice", "This machine" and "External Virtual PC". `features` announces it as `bot-computer-place`; the web page and the Android app draw it, the iOS app when it catches up ([#1375](https://github.com/ladrok/bot-dot/issues/1375)).

## Alternatives

- **Keep one place, ADR 098 as it was.** Rejected by the owner: a team whose members need different computers had to be split across accounts.
- **A bot's own place as the only truth, without the account's.** Rejected: the admin's move (ADR 146) would then need every bot's choice, and a new bot would have no default.
- **Let the Chief move a bot's computer.** Rejected, as in ADR 098: where a bot works and what it may reach there is the owner's call, and a move copies files.
- **A machine of its own per bot on boat.dev (ADR 088).** Rejected again: it was removed for a reason (one running machine and one kit install per bot), and nothing here needs it.

## Consequences

- An account may have bots on both computers. What belongs to one place stays there: the bots on this machine share its one computer, the bots on boat.dev its one machine (ADR 096), and neither reaches the other's files or screen.
- The admin's account-wide move no longer means "every bot": a bot with a place of its own stays. The admin page and the console are unchanged.
- A bot that has `boat` of its own when the admin removes the boat.dev key works on this machine meanwhile, as the account's bots do (ADR 088's fallback), and shows its row so the owner can choose again.
