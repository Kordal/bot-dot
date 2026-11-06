# ADR-155: An update can name its version, and keeps a snapshot of each account's data before its switch

- **Status:** Accepted (2026-11-04)
- **Owning task:** [#979](https://github.com/Kordal/bot-dot/issues/979), part of [#977](https://github.com/Kordal/bot-dot/issues/977)
- **Amends:** [ADR 044](044-an-account-whose-new-server-doesnt-start-goes-back-and-the-others-carry-on.md), whose way back now includes the account's data; its rejected alternative "Snapshot the account's data before the switch" is taken. Keeps [ADR 045](045-the-update-runs-in-phases-of-its-own-apart-from-the-install.md)'s phases and [ADR 036](036-the-admin-pages-update-runs-the-installer-of-the-version-it-installs.md)'s hand-over.

## Context

A machine sold as hosting is run by the fleet console (#977), which tests a release and then moves every machine to exactly that release. The admin's update always took the newest signed release: only the newest is signed under `accounts-release`, so an older or a chosen one could not be checked. And ADR 044's way back puts an account's old compose file and `.env` back, not its data: a new version that starts, changes the data and then misbehaves can't be undone.

## Decision

- **Every signed release keeps a tag of its own.** The image workflow tags the signed index `accounts-release-<the image digest's 64 hex digits>` and `accounts-release-<its 40-character source revision>` as well as `accounts-release`. `lib/signed-image.js --at <hex>` checks that release; the manifest it reads must name that digest or revision, and its signature is checked as before.
- **An update can name its version.** Root's step reads the first line of the `UPDATE` request: empty is the newest, as before; `sha256:<64 hex digits>` names the server image's digest; anything else is refused. The update (`BOT_DOT_UPDATE_TO`) checks that release at `check`, and the bots' computer of the same source revision. A named release older than the one the front door runs (`BOT_DOT_RELEASE` in its `.env`, the signed release number the install records) is refused there. A refusal at `check` downloads and restarts nothing. `update.json` says the version asked for (`named`).
- **Amended 2026-11-05 (#998, this change):** the snapshot is copied with rsync while the server runs and once more with it stopped, it is skipped when the account's disk wouldn't keep a fifth free, and it goes as soon as the new server answers: on hq an account of about 100 GB was down for most of an hour and kept a second copy of its data on a nearly full disk. A rollback request now finds a snapshot only after a switch that didn't finish.
- **A snapshot of the account's data before its switch.** Before an account moves to another signed image, its botdot server stops and root copies its data folder, with the `compose.yaml` and `.env` it ran, into `snapshot/` in its home: root's own folder, on the account's own disk. The snapshot of the switch before goes first, so an account has at most one, and the update's disk preflight counts its room. A new server that doesn't answer gets its data back from it, with its old compose file and `.env` (ADR 044).
- **A rollback request.** `ROLLBACK-<account>` in the requests folder takes that account back to its snapshot: its data, compose file and `.env`, its old image downloaded again by its pinned digest when the cleanup removed it. A server that doesn't answer from the snapshot gets what it ran just before. `status/account-<account>.json` says `rolledback` (with the version it runs), or `kept` or `failed` with why. A snapshot used goes.
- Root trusts a snapshot only when it is a folder of root's, not a link: the account's user owns its home and can rename one, but can't make one root's.

## Alternatives

- **The console sends the signed manifest along with the request.** It would make the console a source of what the machine trusts; the tag on the registry keeps the release where the image workflow put it.
- **Keep the snapshot outside the account's disk.** The machine's disk would fill with every account's data; on the account's disk the snapshot counts against its own share.
- **Snapshot with `docker volume` or filesystem snapshots.** The data is a plain folder on a loop-mounted ext4 disk; a copy needs no new tool.
- **Keep several snapshots.** Doubles or triples the disk an account needs; the off-site backup (#977, C3) is for going further back.

## Consequences

- An account's switch takes longer by the copy of its data, and its server is stopped for it.
- A rollback discards what the account did since its switch.
- Releases published before this have no tags of their own and can't be named; the newest still can be updated to.
- The first named update on a machine whose root's step predates this takes the newest release: the older copy of the installer reads no version from the request.
