# ADR-221: A bot sees every account of its apps and names the one it acts through

- **Status:** Accepted (2026-11-12, the owner: "Bots get lost when there are two of the same connectors")
- **Changes:** [ADR 174](174-an-app-can-have-several-accounts-and-each-bot-uses-one.md) (a bot was told only its own account, and could act through no other)
- **Keeps:** [ADR 010](010-a-connected-app-action-waits-in-its-run.md) (every write still waits for its card), [ADR 192](192-every-bot-has-the-web-files-a-computer-and-every-other-bot.md)

## Context

The owner connected a second Gmail (a work address). Bots set to the first one were told only that one: asked to read the work mailbox, one guessed the work address into Gmail's `user_id` and Gmail answered "Delegation denied", which the bot read as "no access to that mailbox". The Chief then told the owner to connect it again, though it was connected. And a connection that expired and was connected again on the Apps page left every bot set to the dead one, failing with "isn't connected" for good.

## Decision

- **A bot's prompt lists every account of each of its apps with two or more:** by label (the address), its own marked "yours", one that doesn't work said so ("signed out").
- **A bot names the account in `connector_run`** (`account`: its address or id), as the Chief already could; without one, its own. An unknown one is refused with the list. The account a bot is set to stays the owner's choice: naming another is per call, and a write still waits for its card, whose title names the account.
- **A failure says which account it went through** and lists the app's accounts. Gmail's "Delegation denied" is its own kind (`app-other-account`): one account cannot read another's mailbox.
- **A connection made again for the same account takes the dead one's place:** a bot set to a connection that no longer works moves to a working one of the same app with the same label, however it was connected again (Apps page, card, another device). botdot keeps each label it learnt, so it knows the old one after Composio forgets it.

## Alternatives

- **Keep one account per bot and have the Chief move it.** The owner's ask ("check the Ladrok mail") then needs a settings change and a card for a read.
- **An app slug per account.** Rejected in ADR 174 for the same reasons.

## Consequences

- "Allow once" is kept per action and arguments, not per account: a once-grant made for one account could be used by the same run's identical call through another. The card names the account the owner said yes to.
- No change in the apps: the card's title and every sentence come from the server.
