# ADR-153: A bot saves a secret in the Vault on the owner's yes

- **Status:** Accepted (by the owner, 2026-11-04)
- **Owning task:** the owner's request of 2026-11-04 in the project chat: "a bot should be able to write to the Vault after the user approves"
- **Changes:** "Only the owner writes to the Vault" (docs/api.md, Vault)

## Context

An infra bot set up a production database and an app on a server for a launch. It made their passwords and secrets there and wanted to keep them in the Vault, so that it and other bots could use them later without them showing up in a chat. botdot had no way: a bot can read logins shared with it, ask the owner to type a missing one (`request_login`), ask for a switch and ask for a removal. So the Chief offered the owner to copy each secret by hand, which is the slow and leaky path. The owner wants a bot to write to the Vault once they approve.

## Decision

- **A new vault tool, `save_to_vault`.** The bot names the entry, its address, an optional username and type, and where the secret comes from: a file on its computer (`file`), or a new random one botdot makes (`generate`, 32 bytes in base64url). The secret never passes through the bot's tool call, its chat or its context: botdot reads the file itself, and the bot is told only that the card waits. The bot is told to write the file without printing it and to remove it once saved.
- **It waits on a card** (`vault-save`), in the bot's chat and in Needs you, which names the entry, its address, where the secret comes from and the bot it is shared with. The secret waits on the card encrypted with the Vault's key and is never in the list of cards. It needs its own yes: "Allow all" does not give it.
- **The owner can read it first.** The card has the secret as dots and a Show button, which fetches it from `GET /api/asks/:id/secret` (the owner alone; the Chief and the bots' runs are refused). The owner approves what they can see. Show and Hide also sit beside every secret the owner types in the Vault and in the "needs a login" dialog.
- **The yes saves a login shared with that bot alone**, or replaces the secret of the login of that name already shared with it. Nothing else is changed: an entry of another bot or the owner's own is never overwritten, a GitHub App is the owner's to add, and a name taken meanwhile saves nothing. The audit log has every save, with the entry's name and the bot, never the secret.
- A no is kept a week per bot and name, as other Vault cards.

## Alternatives

- **The bot passes the secret as a tool argument.** Simplest, but the value would sit in the run's transcript, its logs and the model's context for good.
- **Only the owner types it in, as `request_login` does.** That is the pop-up that exists, and it does not fit a secret the bot made on a server: the owner does not know it, and copying it by hand is what the owner refused.
- **Save without a card, as the Chief makes an SSH key.** A secret saved unseen could replace a working one or fill the Vault with entries nobody asked for; the owner wants to approve each.
- **No Show on the card.** The owner would approve a value they cannot check, and the Vault page never shows one either. Shown only on the owner's tap, it stays out of the list, the notifications and every other screen.

## Consequences

- A secret can now come from a bot. A bot can still not read one back: it uses it as every saved login, through `api_request`, `run_with_login` (with "Usable in its computer") or `place_secret_file`.
- The secret is on the bot's computer until the bot removes its file, where every bot there could read it ([ADR 035](035-the-account-has-one-computer-all-its-bots-work-on-with-sudo.md)); `generate` leaves nothing there.
- An app from before draws no `vault-save` card (`GET /api/asks?vault-save=1`); it asks the server's `features` for `vault-save`.
