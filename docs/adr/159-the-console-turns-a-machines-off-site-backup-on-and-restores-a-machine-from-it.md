# ADR-159: The fleet console turns a machine's off-site backup on, and restores a machine from it

- **Status:** Proposed
- **Owning task:** the owner's request in the project thread "Add instance management actions" (the fleet console's instance page)
- **Builds on:** [ADR 154](154-one-vps-per-customer-a-managed-machine-run-from-a-fleet-console.md) (the console reaches a machine only through its agent and root's request and status files), [ADR 157](157-the-machine-backs-itself-up-off-site-with-restic.md) (the machine's off-site backup) and the backup set of [#986](https://github.com/Kordal/bot-dot/issues/986) with its restore (`RESTORE`, `put_set`). Leaves [ADR 158](158-an-account-is-backed-up-off-site-and-downloaded-on-request.md)'s owner download as it is.

## Context

A machine gets its off-site backup only from its installer's `.env` (`BOT_DOT_OFFSITE_REPO`, `BOT_DOT_OFFSITE_PASSWORD`). The console gives those to a machine it sets up once a Storage Box is configured, but a machine set up before that, or one whose repository must change, can only get one from a person with root on it, and a managed machine has no SSH. A restore from the repository is `restic restore` by hand (ADR 157's consequences); root's step restores only a set already on the machine's disk, which a machine that holds no second copy (#1014) never has. So the console can neither fix a machine without off-site backups nor move a customer to another machine: a bigger plan, another region, or off a dying host.

## Proposed decision

- **Two more root requests, root's alone like `BACKUP` and `RESTORE`.** One the front door made is refused (`by_root`), and how each went is in a status file.
- **`OFFSITE-SET` turns the off-site backup on or points it elsewhere.** Its lines: the repository's address, the restic password, and, for a Hetzner Storage Box, the sub-account's password once. Root's step writes the address to `.env` and the password to `offsite/password` (600), makes the SSH key if it has none, puts its public half on the box with the sub-account's password (`install-ssh-key`) and forgets that password, opens or makes the repository (`offsite_prepare`) and starts a run. The request file is removed as soon as it is read. An empty request turns the backup off (the address leaves `.env`; the repository and its key stay). Status: `status/offsite.json` as today, `off` while there is none.
- **`OFFSITE-RESTORE` puts a machine back from its repository.** Its first line names a snapshot of a set's manifest, or `latest`, and may name the instance whose backups to read (a machine restores another's when it is moved there). Root's step restores the manifest and its parts with `restic restore` into the set's layout in a scratch folder on the machine's disk and hands that to the restore of #986, which checks it as it checks a set (the same version, the same admin, the parts' sha256) and puts it back; the scratch folder goes when it is done. Status: `status/restore.json` as for `RESTORE`, with the snapshot it read.
- **Both are destructive for the console.** `OFFSITE-SET` decides where every account's data goes, and `OFFSITE-RESTORE` replaces what the machine holds, so the console's agent sends either only with the operator's passkey over the command (botdot-hosting's rule for destructive commands), as `offsite-set` and `offsite-restore`.
- **A move between machines is these steps, run by the console.** A new machine on the same version; the old one backs up once more (`OFFSITE`) and its last snapshot is noted; the new one is given the old one's repository (`OFFSITE-SET` with the same restic password and the sub-account's password, so its own key is added beside the old one's) and restores that snapshot (`OFFSITE-RESTORE`); the customer's hostname then points at the new machine, which gets its certificate; the old machine is deleted once the operator says so, and its key is taken off the sub-account. Writes to the old machine after its last backup are lost, so the console says when the move starts and accounts see a few minutes' pause.

## Alternatives

- **The console's agent writes `.env` and the key itself.** Puts root's off-site setup in a second place, in Rust, against ADR 154's rule that the agent only writes requests and reads status.
- **Move a machine with the owner's `.bdb` download (ADR 158).** Per account, needs each owner's passphrase, and leaves the front door's data (passkeys, sign-up links, the audit log) behind.
- **Copy the whole disk at the provider (a Contabo snapshot).** Ties a move to one provider and one region, and a snapshot of a running machine isn't consistent.
- **Restore straight into place without a scratch folder.** Saves disk, but the restore of #986 checks a whole set before it puts anything back; a half-read set would leave a machine half restored.

## Consequences

- A machine without off-site backups (one set up before the Storage Box) gets them from the console with no SSH.
- `OFFSITE-RESTORE` needs room for one set on the machine's disk while it runs: a move goes to a machine at least as large as the data, which a move to a bigger plan always is.
- Each machine still reads only its own repository, except a new machine during a move, which is given the old one's on purpose; the old key is removed when the old machine is.
- The console needs agent support for two more destructive kinds and a move flow of its own; nothing here changes the front door or the accounts.
