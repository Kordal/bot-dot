# ADR-044: An account whose new server doesn't start goes back to its old version, and the others carry on

- **Status:** Accepted (2026-10-20). Amended by [ADR 053](053-each-account-owner-chooses-when-their-account-switches-to-a-new-version.md): an account whose owner turned "Update automatically" off waits on the version it runs.
- **Owning task:** [#194](https://github.com/Kordal/bot-dot/issues/194), part of [#189](https://github.com/Kordal/bot-dot/issues/189)
- **Supersedes:** "A failed update is still not rolled back" in [ADR 036](036-the-admin-pages-update-runs-the-installer-of-the-version-it-installs.md)

## Context

The installer updates the front door and then every account, one after another. Until now anything that failed for one account (its download, its Docker's runtimes, its new botdot server) ended the whole run with `die`: the accounts after it stayed on the old version, the ones before it were on the new one, and an account whose new server didn't start stayed down. On hq.botdot.app on 2026-10-20 one account's full disk stopped the update for every account (#189).

The installer also took "its socket is there" as "its server started". A server that stops leaves its socket behind (the next one removes it as it starts), so a new server that never started looked like one that did.

## Decision

- **Each account that ran already is updated on its own.** The installer runs it in a subshell; what fails there (`die`) ends that account only, with its reason, and the run goes on with the next account. A new account (the admin's on the first install, one a sign-up link made) stops the run as before: it has nothing to go back to.
- **What fails once the new compose file is written** (its owner, starting it, its answer) puts the old one back, so that an account reported kept runs what it ran.
- **A download that fails keeps the account where it is.** The downloads into every account's Docker still come before anything restarts; an account whose download fails is held back and isn't switched.
- **Before an account is switched,** its `compose.yaml` and `.env` are kept beside them (`compose.yaml.before`, `.env.before`). The new server must **answer** within about 2 minutes: its socket is there and `GET /api/version` on it answers. If it doesn't, the installer prints the last lines of its log, puts both files back and starts the old version again. The old version's images are still in the account's Docker: the cleanup after an update runs only once the new server answers, and the cleanup before a download keeps the images the account's `.env` names (#190).
- **Each account's result** is `updated`, `kept` (it runs the version it ran, named when its image says it, with why) or `failed` (neither version answers, with why). The installer writes one line per account in the file the admin page's update hands it (`BOT_DOT_UPDATE_RESULTS`), and root's step puts them in `update.json` as `accounts`. A run that kept any account back ends failed once everything else is done ("Not every account was updated: bob. The others run the new version."), and the admin page names each account kept back and why.
- The front door is not rolled back: it is one for every account, and it works with an account of the version before (an app older or newer than its server keeps working, AGENTS.md).

## Alternatives

- **Roll back the whole machine when one account fails.** One account's full disk would keep every account on the old version, which is what #189 is about.
- **Keep the old container and switch only once the new one answers** (blue-green). An account has one socket and one data folder that two servers can't share; it needs the phased updater of #189's ticket 6.
- **Snapshot the account's data before the switch.** A new server that doesn't start hasn't changed the data in a way the old one can't read today; a migration that does would need its own way back, and a copy of every account's data doubles the disk the update needs.

## Consequences

- An account can run another version than the front door and the other accounts until the next update. `version.json` names the version the front door and the updated accounts run; `update.json` names the ones kept back.
- The first update from a root's step installed before this one hands its results to no file (its `update_all` is the old one): that update ends failed as before when an account is kept back, without the list.
- The rollback starts the old version again; it doesn't make it answer. An account whose old version doesn't answer either is `failed`, and its owner sees that its botdot server isn't running.
