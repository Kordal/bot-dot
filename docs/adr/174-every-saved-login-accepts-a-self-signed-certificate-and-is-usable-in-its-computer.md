# ADR-174: Every saved login accepts a self-signed certificate and is usable in its computer

- **Status:** Proposed (2026-11-09, waits for the owner's yes to the trade-off below)
- **Owning task:** the owner's request to remove the Vault's two switches and keep both on
- **Supersedes:** the switches "Accept self-signed certificate" (`insecureTls`) and "Usable in its computer" (`inComputer`) of a saved login, and the bot's `ask_vault_switch` (docs/decisions/2026-10-18-a-bot-may-use-a-saved-login-in.md, docs/decisions/2026-10-18-a-bot-that-needs-a-switch-of-a.md)
- **Builds on:** [ADR 035](035-the-account-has-one-computer-all-its-bots-work-on-with-sudo.md) (one computer, every bot on it with sudo)

## Context

The Vault's editor had two switches per login. The owner ticked them for nearly every login their bots used, and a bot that met one off stopped and asked on a card. The owner asked to remove both and have them always on.

## Decision

- **Both are on for every login, one saved with either off too.** `api_request`, `run_with_login` and Board tiles accept a self-signed certificate of any saved login's server, and `run_with_login` hands any login shared with the bot to its command. Nothing stored is rewritten: the server reads every login as on (`insecureTls: true`, `inComputer: true` in `GET /api/vault`, for apps that still draw a switch), ignores either sent in a save, and stops keeping them for new logins.
- **The bots a login is shared with still decide, out of sight.** The login editor shows no bots and sends none, so a save keeps the ones it has; a bot gets a login when the owner answers its `request_login`, or through the Chief. A login reaches a request or a command only for a bot it is shared with, as before. Cards, identities, SSH keys and files keep their list of bots.
- **No switch, no card.** The web page and the Android app draw neither switch nor its words on a login's line; the dialog of a bot's request has no certificate switch. Bots lose `ask_vault_switch` and are no longer told to ask for a switch. A `vault-switch` card still waiting is drawn and answered as before; its yes changes nothing.

## Trade-off

- **Any login a bot may use can be read on the account's computer.** A bot it is shared with controls its command and can get the value; while the command runs, every other bot on that computer can read it too (they all have sudo, ADR 035). Before, only logins the owner marked were exposed this way.
- **No certificate check for saved logins.** A request made with a saved login no longer proves it reached the real server, so a network attacker between botdot and that server could take the secret. Public services (GitHub, OVH) lose that check too.

## Alternatives

- **Keep "Usable in its computer" per login, off by default:** the safer default, rejected only if the owner confirms the trade-off.
- **Accept a self-signed certificate only for private addresses (LAN, Tailscale):** keeps the check for public services; not asked for.
