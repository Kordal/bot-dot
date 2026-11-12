# ADR-158: An account is backed up off-site and downloaded on request, never kept on the machine

- **Status:** Accepted (2026-11-05)
- **Owning task:** the owner's request in the project thread "Make Backups off-site only with user download" (follows [#1014](https://github.com/Kordal/bot-dot/issues/1014))
- **Builds on:** [ADR 157](157-the-machine-backs-itself-up-off-site-with-restic.md) (the machine's off-site backup), the `.bdb` format of `lib/backup.js` and its restore, and the move between machines planned in #1014 (M2 to M6).

## Context

Two backups ran side by side. Each account made its own `.bdb` every night at 03:00 into its `data/backups`, encrypted with a passphrase its owner set in Settings, and kept the last 7; the machine backs every account up off-site with restic since ADR 157. The account's copies sit on the same disk as the data they copy, so they protect against nothing a disk or a VPS loss takes, and they cost room: on hq one account held 26 GB of them and its unfinished parts. An owner who wants a file of their own account in hand (to keep, or to take to another machine) still needs one, and the restic repository, one per machine and keyed by root's password, can't be handed to an owner.

## Decision

- **One backup: the machine's off-site one.** An account makes no backups of its own and has no nightly job. Settings → Backups shows one row: when this account's data last went off-site, `Backing up…` while a run is under way, `Failed` when the last run didn't back up its data (with the last good time; on the web page the value turns red once it is late, after 26 hours), or `Off` on a machine with no off-site backup.
- **The front door tells each account its own state.** Root's step's `status/offsite.json` holds the machine's last run. The front door reads it every minute and, when it changes for an account, posts `{ state, lastSuccess, late }` to that account (`POST /api/backups/offsite`, the front door's header alone). An account's data counts as backed up in a run when its `accounts/<name>/data.tar` part was; when that last happened is kept by the front door in `offsite-accounts.json`, since the status file names only the last run. The account keeps what it was told in `data/backups/state.json`. Nothing of the repository, its password or its errors reaches an account.
- **Download is a `.bdb` made on request.** The owner picks a passphrase (12 characters or more) and Download asks for one (`POST /api/backups/download`): the server copies `memory.db` and derives the key, then answers with an address (the computer's `/workspace` is packed meanwhile and goes last in the file: a big one can take minutes to pack, and the page waited on it with nothing to show, [decision](../decisions/2026-11-12-a-backup-download-starts-before-the-computers-files-are-packed.md)) fetched once within 15 minutes (`GET /api/backups/download/<token>`), which a browser's download and Android's download manager both fetch with no body. The file is encrypted and gzipped as it is written to the response, so the machine never holds it. It is the format the restore already reads, so a download restores into a fresh account on this machine or another, which is what a move between machines needs before its own steps exist.
- **The passphrase is chosen per download, not kept.** Only the key derived from it lives in memory until the download ends or expires; the machine stores no backup key.
- **The old files go once nothing needs them.** An account's nightly `.bdb` files and its `backup.key` are removed once the front door says its data is off-site (`lastSuccess`), or once its owner downloads a backup whole. A machine without an off-site backup keeps them until a download. Old files still restore, both their formats.
- **Self-hosting without an off-site repository** shows `Off` and keeps Download: its owner takes a copy off the machine by hand, or its admin names a repository (ADR 157).
- **What was told of late account backups goes.** #1017's message after 48 hours without an account backup has nothing to watch; what it remembered is cleared. The admin's message about the machine's off-site backup stays.

## Alternatives

- **Keep the nightly `.bdb` on machines without off-site.** Two modes in the code and both apps, for a copy on the same disk as the data; Download does the same job when the owner wants it.
- **Download from the restic repository.** Needs root's password or a restic in the account, and a repository that holds every account of the machine: an owner must never reach another's data or the password.
- **Make the download into a file on the machine first, then serve it.** A full extra copy on the disk for each download (hq can't spare it), and one more thing to clean up after a restart.
- **The front door answers `GET /api/backups` itself.** Splits one screen's answer between two servers; the account's own route is what the apps and the Chief's later tools already ask.

## Consequences

- An account's backups no longer use its disk; hq frees what is left of the old ones on its first off-site run after the update.
- A download of a large account takes as long as its packing: the button says `Preparing…` until the file starts. A download cut off midway leaves nothing behind and is asked for again.
- An Android app older than this shows Backups as off and can't download; an app checks `backup-download` in `features`. The old routes answer `410`.
- The move between machines (#1014 M2 to M6) can start from a downloaded `.bdb` restored on the new machine, or from the off-site repository, root's alone.
