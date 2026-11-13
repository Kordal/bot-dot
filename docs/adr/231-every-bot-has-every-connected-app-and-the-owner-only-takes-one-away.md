# ADR-231: Every bot has every connected app, and the owner only takes one away

- **Status:** Accepted (2026-11-13, the owner's ask: "All bots should get access to all connectors. User should be able to only take it away")
- **Changes:** [ADR 168](168-a-missing-app-is-one-connect-card-and-connecting-it-carries-the-work-on.md) (a bot no longer waits for a card to get an app that is connected; its Connect card still connects one that isn't), [ADR 174](174-an-app-can-have-several-accounts-and-each-bot-uses-one.md) (a bot's `connectors` is no longer the list of apps it was given)
- **Keeps:** [ADR 192](192-every-bot-has-the-web-files-a-computer-and-every-other-bot.md) (every bot has everything), [ADR 221](221-a-bot-sees-every-account-of-its-apps-and-names-the-one-it-acts-through.md) (the accounts a bot sees and acts through), Passwords and their rules, which are not apps

## Context

A bot used an app only once it was given it: by the owner in its settings or on the Apps page, by the Chief's `update_bot connectors` after a card, or by the card of its own ask. An owner who connected Gmail still saw a card per bot ("Let Writer use Gmail?", "Connect GitHub for Writer") before each bot could read their mail, and every new bot started with none. Every other power of a bot is everyone's since ADR 192.

## Decision

- **A bot's apps are every connected app less the ones the owner took away.** bots.json keeps `appsOff` (the apps taken away) and, in `connectors`, only the apps given by name that no account lists (an app without a sign-in). What the server hands out as `connectors` is the apps with an account in Composio's list (working or signed out; not a sign-in only begun), those given by name, less `appsOff` (`lib/bots.js` withApps, `lib/connectors.js` accountApps). An app connected later is every bot's at once, with no card and no change to any bot.
- **Taking away is the owner's change of `connectors`**, as before: a bot's settings or the Apps page leave a connected app out, and it goes to `appsOff`; putting it back takes it out. No request sets `appsOff` itself.
- **What leaves because it is gone is not taken away.** An app disconnected, or not connected again after a switch of Composio account, leaves every bot; connected again, every bot has it, and a bot it was taken from still has it off.
- **The Chief or a bot giving one back waits for the owner** (a changed bot's card), as giving an app did: only the owner gives back what the owner took away.
- **The apps draw nothing new.** Their per-bot app switches and the Apps page's bots per app already show `connectors` and send it: every switch is on until the owner turns one off.

## Alternatives

- **Give every bot every app once, in a migration.** An app connected later would need the grant again, and every bot made later too.
- **A per-app "every bot" switch on the Apps page.** One more control for what is now true of every app; the per-bot switches already take one away.

## Consequences

- Every bot that exists has every connected app after the update: no bot had one taken away before (a bot without an app had never been given it), so there is no denial to keep. A "Not now" on a card to give an app was a week's hold, not a denial.
- The connected-app cards for bots ("Let <bot> use <App>?") come only for an app the owner took away, when the bot asks for it again.
- A prompt injection that reaches any bot reaches every connected app; every write in one still waits on its card (ADR 010).
