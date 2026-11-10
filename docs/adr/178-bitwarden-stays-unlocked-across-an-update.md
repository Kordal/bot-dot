# ADR-178: Bitwarden stays unlocked across an update

- **Status:** Accepted (2026-11-10, the owner's go on "less heavy, less minding the bots", option A)
- **Changes:** the rule of `lib/bitwarden.js` that every restart of botdot locks Bitwarden
- **Keeps:** the master password is never kept; a plain restart and a reboot still lock it; Lock locks at once

## Context

Every update restarts botdot, and every restart locked Bitwarden. After an update the bots that need a login waited until the owner came back and typed the master password. Owners felt they had to mind their bots by hand.

## Decision

- **As botdot exits**, an unlocked Bitwarden session is written to `data/bitwarden-carry.json` (0600), encrypted with the Vault's key (AES-256-GCM; the key lives outside the data folder), with a stamp of the code that runs now: a hash of `server.js` and every `.js` file under `lib/`.
- **As botdot starts**, it reads that file and removes it at once, whatever it holds. It unlocks with the session only when the stamp differs from the code that starts (an update) and the file is at most 15 minutes old. `bw` checks the session as it reads the folder; a session it refuses leaves Bitwarden locked, as before.
- **Lock** removes the file too, and a locked Bitwarden writes none.

## Alternatives

- **"Remember the unlock for 7 days".** Rejected for now: the session would sit on the disk for a week, for every restart.
- **Keep the master password.** Rejected: it never leaves the pop-up.

## Consequences

- An update no longer stops the bots that use logins.
- For up to 15 minutes, between the exit and the next start, the session is on the disk, encrypted with the same key as the built-in Vault's passwords. Whoever holds the data folder and that key could read the Vault anyway.
- A plain restart on the same code (`docker restart`, a reboot) still locks it: the owner sees the pop-up as before.
