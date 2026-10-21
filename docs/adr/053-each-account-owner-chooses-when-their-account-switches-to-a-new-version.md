# ADR-053: Each account's owner chooses when their account switches to a new version

- **Status:** Accepted (2026-10-21, the owner's request in [#259](https://github.com/Kordal/bot-dot/issues/259)). Amends [ADR 044](044-an-account-whose-new-server-doesnt-start-goes-back-and-the-others-carry-on.md) (an account one version behind is now a normal state, not only a failure) and [ADR 045](045-the-update-runs-in-phases-of-its-own-apart-from-the-install.md) (the phase `switch` leaves some accounts waiting).
- **Owning task:** [#259](https://github.com/Kordal/bot-dot/issues/259)

## Context

On a machine of several accounts the admin's Update switches every running account to the new version at once (ADR 044, 045). An account's owner can't say "not now": their bots restart in the middle of their work whenever the admin updates.

Most of what a later switch needs is there already. The update downloads the new version into every account's Docker before anything restarts, and switches each account on its own with a way back (ADR 044). An account kept on the version before keeps its old images, and the front door works with an account one version behind it. Root's step (`install.sh --requested`) already settles one account at a time under the installer's lock (ADR 036), and resuming a suspended account brings it to the version the front door pins.

## Decision

- **A setting per account, "Update automatically", on by default.** The front door keeps it (`autoUpdate: false` in the account's entry of `front-door.json`; no field is on), and only the account's owner changes it, in Settings on the web page and in the Android app. The admin's own account has none: it always moves with the admin's Update.
- **The admin's Update does all it did** (check, clean, preflight, download into every running account, hand-over, front door, ADR 045). In its phase `switch` it leaves an account **waiting** when its owner turned "Update automatically" off and the account ran the version the front door pinned until now, or it waits already for this very version. Every other account switches as before: the admin's, one set to update automatically, one kept back by an earlier failure, and one that would otherwise be **two versions behind** (it still waits while the admin installs a newer one). A waiting account keeps running, with the new images already in its Docker. It is in `update.json`'s `accounts` as `waiting` with the version it runs, and its old images are not cleaned (as for `kept`). A waiting account doesn't fail the update.
- **Root says what became of each account** in `status/account-<name>.json`, which only root writes and the front door reads: `waiting` (with `since`, the version it waits for and the one it runs), `switching`, `updated`, `kept` or `failed` (with why). An account switched by any means (the admin's Update, a resume, its owner, the deadline) says `updated`.
- **"Update now" switches one account.** Its owner (Settings), or the admin (the admin page's account card), asks the front door, which writes an empty request `SWITCH-<name>` beside the others (no account can be named so). Root's step switches that account alone to the version the front door's `.env` pins, with ADR 044's way back, under the installer's lock, so it never overlaps a machine update. It downloads nothing new: the version is the one the admin installed. An account that runs it already, or isn't running, is left as it is. The owner can do nothing else of the update: downloading, the signature, the installer, the front door, cleaning the machine and the deadline stay the admin's.
- **A deadline.** An account still waiting N days after its version came (default 7, 1 to 60, set on the admin page) is switched without its owner: the front door asks for its switch when the deadline passes, as "Update now" does. Settings shows the owner the date.
- **The disk check counts both versions as it did.** The preflight of #192 measures an account's free disk with its current images on it, and asks for room for the new layers three times over and 1 GB more. A waiting account keeps both versions after the update, which that room already holds. The account that waits for N and gets N+1 is switched, and the cleanup before N+1's download removes N's images it never ran, so an account never holds more than two versions.
- **What the admin runs by hand still switches everyone:** `sudo sh install.sh` is the admin at the machine, not the admin page.

## Alternatives

- **Let owners download their own update.** Every owner would need the signature check and the registry; a full disk would again be one owner's problem the admin can't see. The admin downloads, the owner only chooses when to restart.
- **Keep a waiting account two or more versions behind.** The front door promises to work with an account one version behind it, not more; the installer would need every version's compose file and runtimes. One version behind at most.
- **Root's step enforcing the deadline.** It would need the admin's setting, which is in the front door's data, read every minute with the image's Node. The front door already knows the setting and the time; root only does the switch it is asked for.
- **Turning "Update automatically" back on switches at once.** A switch restarts the account's bots; the owner may turn it on while they work. It applies from the next update, and "Update now" is beside it.

## Consequences

- An account can run the version before the front door's for up to N days in normal use, not only after a failure. `version.json` names the front door's version; `update.json` and the account's status file name the ones that wait.
- An update that finds every account on the newest version, or waiting for it, restarts nothing (#193): a waiting account no longer makes "nothing new" look like something new.
- The first update from a root's step installed before this one switches every account: the front door before it keeps no `autoUpdate`, and every account is on.
- A switch request that root's step never finished (the machine restarted) leaves the account `switching`; the front door shows it failed after three hours, and "Update now" asks again.
