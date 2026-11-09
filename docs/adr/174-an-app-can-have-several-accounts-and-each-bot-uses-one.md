# ADR-174: An app can have several accounts, and each bot uses one

- **Status:** Accepted (2026-11-09, the owner asked why a second Gmail could not be connected)
- **Changes:** [ADR 168](168-a-missing-app-is-one-connect-card-and-connecting-it-carries-the-work-on.md) (an app that works already draws a Connect card when the owner wants another account of it: mode `another`)
- **Keeps:** [ADR 010](010-a-connected-app-action-waits-in-its-run.md) and [ADR 047](047-the-chief-uses-connected-apps-in-the-owners-turns-and-every-write-waits-for-an-ok.md) (every write still waits for its card, whichever account it goes through)

## Context

A bot had an app by its slug (`gmail`), and every action went through the newest working connection of it. That was one account per app: a second Gmail could not be offered by the Chief (an app that works got no card), the Connectors page had no way to start it, and had it been connected, every bot with Gmail would have moved to it without a word.

## Decision

- **A bot is set to one account of an app:** `accounts: { app: connection id }`, beside `connectors`. An app without one uses the newest working connection, as before, so nothing changes for one account.
- **One more account never moves a bot.** Before its sign-in starts (`POST /api/connectors/connect` with `another: true`, or Connect on a card of mode `another`), every bot that has the app and no account set is set to the one it uses then.
- **The Chief offers it:** `offer_connect_app` with `another: true` makes a Connect card of mode `another` ("Connect another Gmail account for Writer"). It settles only on a connection made after it, and the card's bot is set to that one.
- **A bot set to an account that stops working** gets the Reconnect card for that account (`replaces`): once connected again, every bot set to the old connection moves to the new one. Disconnecting an account takes the app from the bots set to it, even when another account is left: that account is not the one they were given.
- **Each account has a label:** its alias in Composio, else what botdot reads of it (Gmail's own profile: its address, kept as the alias), else "Gmail 2". The run is told its account by label.
- **Moving a bot to another account is the owner's.** On Connectors (an account's Bots…) and in the bot's settings (a row per account, one at most), the owner sets it; the Chief's `update_bot accounts` waits on a changed bot's card, as a new app does.

## Alternatives

- **An app slug per account** (`gmail:work`). Every tool, prompt, grant and card that names an app would learn a second name. The account is a setting of the bot, not another app.
- **Ask Composio for the newest account per bot each time.** It moved every bot to whatever was signed in last, which is the bug.

## Consequences

- An app older than this sends no `accounts` and draws one row per app: its bots keep the account they were set to.
- Grants of actions ("Always allow") stay per bot and app, not per account.
