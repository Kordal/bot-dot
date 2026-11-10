# ADR-160: The installer gives the admin's account its Composio key

- **Status:** Accepted; the key is the machine's and goes to every account since [ADR 206](206-the-machines-composio-key-goes-to-every-account.md)
- **Owning task:** the owner's request in the project thread "Ask for Composio key at install"
- **Builds on:** the installer's keys of [#937](https://github.com/Kordal/bot-dot/pull/937) (Jev's OpenRouter key and the boat.dev key, `data/install-keys.json`), and the rule of [#440](https://github.com/Kordal/bot-dot/issues/440) that connectors run only on a Composio key the owner made.

## Context

A first install asks for the OpenRouter and boat.dev keys, which are the machine's: the front door keeps them and hands them to every account. Connectors are different: the Composio key is each account's own (`data/connectors.json`, encrypted with the account's Vault key), and every app an account connects lives in that key's Composio project. The admin, who installs botdot, then had to find the Connectors page and paste a key before any bot could use an app.

## Decision

- **A first install asks for a Composio key as it asks for the other two**, with the same question shape, the same check (the image's `lib/connectors.js` `checkKey`, the key on standard input), `BOT_DOT_COMPOSIO_KEY` to answer beforehand (empty: no), never on botdot on this computer only. Each question shows the address where its key is made before the prompt.
- **The key is the admin's account's, never the machine's.** The front door takes it from `install-keys.json` into `composio-key.json` (600) and hands it every minute to the admin's account (a managed machine's first account) on `POST /api/connectors/install-key`, the front door's alone. The account may not be made yet when the install ends; the key waits until it answers.
- **It never replaces the owner's key.** An account that already has a key keeps it (`kept`); otherwise it checks the key with Composio and keeps it as one pasted on the Connectors page. Any answer but none, a 5xx or a Composio that can't be reached ends the hand-off and the file goes.

## Alternatives

- **One machine-wide Composio key for every account.** Every account's connected apps (mail, calendars) would sit in the admin's Composio project, which the admin could read; it is also against #440's own-key rule for everyone but the admin.
- **Keep the key in `.env` and hand it at every start.** A key there would come back over one the owner later changed or removed on the Connectors page.

## Consequences

- The admin's bots can use apps from the first sign-in. Other accounts still paste their own key on the Connectors page.
- The front door holds the key in plain text in its data folder (600) only until the admin's account takes it, as `install-keys.json` already does.
