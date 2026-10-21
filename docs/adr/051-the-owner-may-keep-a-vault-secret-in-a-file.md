# ADR-051: The owner may keep a Vault secret in a file

- **Status:** Accepted (by the owner, 2026-10-21)
- **Owning task:** [#253](https://github.com/Kordal/bot-dot/issues/253)
- **Changes:** "botdot puts a secret in a file only for `run_with_file`, for one command" ([ADR 039](039-a-saved-file-is-in-the-computer-for-one-command.md), SECURITY.md) and the bots' rule "never print, store or encode a saved secret"

## Context

An infra bot was asked to put OVH API keys from the Vault into an env file for Traefik's DNS challenge. Its rules said never to store a saved secret, and nothing in botdot could do it for it, so it refused and told the owner to make the file by hand over SSH. The owner wants a rule like this to be one they can lift. Software that reads its secrets from a config or env file (Traefik, Proton Bridge, systemd units) is common on the account's computer and on the owner's servers.

## Decision

- **botdot writes the file, the bot names it.** A new computer tool, `place_secret_file`, takes Vault entries shared with the bot (logins and files), a template with `{{NAME.password}}`, `{{NAME.username}}` and `{{NAME.file}}`, a path, a mode and an owner. botdot fills the template and writes the file whole: as root on the account's computer, or on another server over SSH with a saved SSH key from the bot's screen. The bot never sees a value, and what comes back has every secret blanked out.
- **Each place needs the owner's yes on a card** (`vault-file`), which names the secrets and the file and warns plainly that the secret stays on disk, where every bot on the account's computer can read it (they all have sudo, [ADR 035](035-the-account-has-one-computer-all-its-bots-work-on-with-sudo.md)), or anyone who can read files on that server. A place is the bot, its entries, the template (shown on the card), the target and its SSH key, the path, the mode and the owner: a yes never covers other text in that file. After the yes the same place is written again without a card, so a secret changed in the Vault reaches the file.
- **The Vault shows where each secret lies** ("Placed in"), with "Remove the file": botdot deletes the file where it wrote it, and the yes goes with it.
- **The audit log** has every yes, write and removal, with the bot and where, never which secret.
- The path, mode, owner and host are kept plain (letters, digits and a few signs), so botdot quotes them safely for a shell here and over SSH.

## Alternatives

- **Let the bot write the file with `run_with_login`.** It can already, with a login marked "Usable in its computer", but against its rules and with no record of where the secret went. The owner would not see it on the Vault page or be able to remove it.
- **Only the owner makes such a file, by hand.** That is what the bot told them to do, and what the owner does not want.
- **One card per write.** A rotated secret would need the owner again for a file they already allowed.

## Consequences

- "A bot never reads a stored Vault value" now holds for the bot's chat and context only: by the owner's choice per place, the value can lie in a file that bots on the account's computer can read.
- An app from before draws no `vault-file` card (`GET /api/asks?vault-file=1`) and no "Placed in"; it asks the server's `features` for `vault-file`.
- A file on another server is written as the SSH user: an owner other than that user needs it to be root there.
