# ADR-161: The admin page connects a Hetzner Storage Box for the off-site backup

- **Status:** Accepted (2026-11-05)
- **Owning task:** the owner's request in the project thread "Connect Storage Box from admin page"
- **Builds on:** [ADR 157](157-the-machine-backs-itself-up-off-site-with-restic.md) (the off-site backup, root's step), [ADR 028](028-botdot-serves-several-accounts-on-one-machine-each-walled-off.md) (the admin page) and the `OFFSITE-SET` request [ADR 159](159-the-console-turns-a-machines-off-site-backup-on-and-restores-a-machine-from-it.md) proposes for the console. Amends ADR 157's rule that only root asks for `OFFSITE`.

## Context

The off-site backup is set up only over SSH, as root: name the repository, run `install.sh --offsite`, add the printed key to the Storage Box from another computer with the sub-account's password, run it again, copy the password from the terminal. The owner of a self-hosted machine wants it from the admin page, and doesn't want to make a sub-account by hand either.

## Decision

- **A Hetzner API token makes the sub-account.** The admin pastes an API token of the Hetzner Console project that holds the Storage Box. The front door lists the project's boxes (the admin picks one when there are several), and makes a sub-account named after the machine, `botdot-<first label of its host>`, with its own folder, SSH on, reachable from outside, and a new random password; one of that name already there (a setup tried again) gets a new password instead. One sub-account per machine, as ADR 157 says: it holds every account of the machine, each part tagged `account=`, so one account can be restored or moved by itself.
- **Root's step puts the key on and opens the repository.** The front door writes `OFFSITE-SET`: the repository's address, an empty line, the sub-account's password. Root's step removes it as it reads it, keeps the address in `.env`, makes the SSH key if there is none, puts its public half on the sub-account with that password once (`install-ssh-key`, through `SSH_ASKPASS`, tried for about a minute while Hetzner finishes), forgets the password, opens or makes the repository (`offsite_prepare`) and starts a run. A failure takes the address out of `.env` again and says `off` with `setup: true` and the error, which the page shows under the form.
- **A front door may ask for less than root.** From the front door, `OFFSITE-SET` must name a Storage Box (`sftp://<user>@<host>.your-storagebox.de:23/botdot`), and its second line, the repository's password, is ignored: root's step makes it. Root may give either, as ADR 159 proposes for the console.
- **The repository's password is shown once.** A password root's step made is left in the front door's data (`offsite-password.json`, 600, the front door's own), and the admin page shows it until the admin says it is saved; then it is removed. Neither the token nor the sub-account's password is kept or logged anywhere.
- **"Back up now" is the admin's too.** `OFFSITE` from the front door now starts a run, as one from root does. A run under way isn't started twice.
- **The admin picks how many backups are kept.** By default ADR 157's 7 daily, 4 weekly and 3 monthly; or the N latest (1 to 99, each part's own), which the admin page writes to `offsite-keep.json` in the front door's data and root's step reads as `forget --keep-last N`, taking anything else as the default. A changed number is pruned at that night's run, not within the week. Fewer backups free room on the box sooner but reach back less far: the Storage Box's own snapshots are still the guard against a deletion.
- **The command line stays.** `BOT_DOT_OFFSITE_REPO=… install.sh --offsite` works as before, for any restic repository.

## Alternatives

- **The admin types the sub-account and its password.** Saves the token, but the owner then makes the sub-account by hand in the Hetzner Console; the token is used once and kept nowhere, so it adds no lasting risk.
- **Show the key and the `install-ssh-key` line for the admin to run.** Needs a terminal with SSH elsewhere, the step the page is meant to remove.
- **A sub-account for each account.** Root's step backs them all up with the same key, so separate sub-accounts separate nothing, and each would need its own password kept somewhere.
- **The front door calls `ssh` itself.** The front door has no SSH and should not hold the machine's key; root's step has both.

## Consequences

- Someone who takes over the front door could point a backup at a Storage Box of their own. They could read every account through the front door already, so this opens nothing new; the address is limited to Storage Boxes and the change is in the audit log (`offsite-connected`).
- A machine set up from the page has no way to change or turn off the repository from the page yet; that is root's (`.env`) or the console's (ADR 159).
- The token's project must hold the Storage Box: Storage Boxes moved to the Hetzner Console, and an older Robot-only box needs the command line.
