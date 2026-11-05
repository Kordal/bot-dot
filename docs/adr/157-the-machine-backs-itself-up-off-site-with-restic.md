# ADR-157: The machine backs itself up off-site with restic, from root's step

- **Status:** Accepted (2026-11-05)
- **Owning task:** [#1016](https://github.com/Kordal/bot-dot/issues/1016), part of [#1014](https://github.com/Kordal/bot-dot/issues/1014)
- **Builds on:** the backup set of [#986](https://github.com/Kordal/bot-dot/issues/986) (its parts and owner maps), [ADR 154](154-one-vps-per-customer-a-managed-machine-run-from-a-fleet-console.md) (the fleet console reads root's step's status files) and the instance id of [#982](https://github.com/Kordal/bot-dot/issues/982).

## Context

No botdot machine had a copy of its data anywhere but its own disk. An account's own backup (`.bdb`) lands in its `data/backups`, on the same disk, and skips the account's computer; the backup set of #986 is a second full copy on that disk, which hq, at about 105 GB of data on a 211 GB disk, can't hold. A lost disk or a lost VPS lost everything. The owner has a Hetzner Storage Box to spare, a machine that should not be able to read what it keeps.

## Decision

- **Root's step backs the machine up, every night, straight to the repository.** A machine whose front door's `.env` names `BOT_DOT_OFFSITE_REPO` (a restic repository's address) runs `install.sh --offsite` from `botdot-offsite.timer` at 02:00 plus the instance id modulo 120 minutes, on the machine's clock (`Persistent=true` catches a night it was off), and at once on a root-made `OFFSITE` request. Each part of a set (the front door's data, then per account `data.tar`, `env`, `config.tar` and the computer's volumes, then a manifest) is one `restic backup --stdin-from-command` of the tar the set makes, owner maps kept, so nothing is written to the machine's disk first. A tar's exit 1 (a file changed while it was read) counts as success. A part that fails is named and the others go on.
- **An account's data leaves out what needn't go:** `data/backups`, `node_modules` and `*.part`. Its `memory.db` is, as in a set, the consistent copy its server makes on request (#1015) in the live file's place, or the file as it is when the server doesn't run.
- **restic, pinned.** restic encrypts (AES-256, keyed from the password) and authenticates on the machine, deduplicates across nights, and the Storage Box speaks its SFTP backend. The installer downloads restic 0.19.1 into root's `BOT_DOT_DIR/bin` and checks it by its sha256; only when that can't be done does it take a restic the machine has, of 0.17 or newer (the first with `--stdin-from-command`). The repository is made on first use, format 2 (compressed).
- **One repository and one Storage Box sub-account per machine.** A machine's SSH key reaches only its own sub-account's folder, so one machine taken over can't read or delete another's backups. Snapshots carry the tags `instance=`, `part=` and `account=`, and the host is the instance id.
- **The password never leaves the machine except to its escrow.** `BOT_DOT_DIR/offsite/password` (600, folder 700) is made at random unless `BOT_DOT_OFFSITE_PASSWORD` gives one; a person running the step sees it once, otherwise the step says where it is. A copy is kept off the machine (Bitwarden): the Storage Box never holds it. The SSH key (`offsite/ssh_key`) is made the same way, and its public half is printed with the line that installs it on a Storage Box.
- **Deletion is guarded outside the machine.** restic keeps 7 daily, 4 weekly and 3 monthly snapshots (`forget`), and prunes once a week. Someone with root on the machine could delete the repository through the same key, so the Storage Box's own automatic snapshots, which the machine can't change, are the protection against that.
- **Status for the console.** `front-door/status/offsite.json` says `state` (`backing-up`, `done`, `failed`, `refused`), `started`, `finished`, `lastSuccess`, `bytesAdded`, each part's snapshot id, the parts that failed, the part it stopped in and the error.

## Alternatives

- **Upload the backup set of #986 with rsync or rclone.** Needs the set on the machine's disk first (hq can't hold it), and the copy on the box would be readable there unless a second tool encrypted it.
- **The console's agent takes the set off the machine** (as #986's text first said). Puts days of work in front of the first off-site copy, and the agent would still need the set on disk.
- **borg.** Encrypted and deduplicating too, but it needs borg on the far side; restic needs only SFTP, and also speaks S3 and others for a later target.
- **Encrypt with the Storage Box's own features.** It has none for data at rest that the box can't read.
- **One repository for every machine.** Deduplicates across machines, but one machine's key would reach every customer's backups.

## Consequences

- The first night uploads everything (on hq about 100 GB), later nights what changed. It reads every account's files as the set does, under `Nice=10` and idle I/O.
- Losing the password loses the backups: the escrow copy is part of setting a machine up.
- A restore from the repository is `restic restore` or `restic dump` of the parts into a set's layout by hand until a restore step reads it (#1014).
- A machine without systemd isn't backed up nightly; an `OFFSITE` request still runs it, in the background.
