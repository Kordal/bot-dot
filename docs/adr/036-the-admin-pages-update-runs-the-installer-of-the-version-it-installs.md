# ADR-036: The admin page's update runs the installer of the version it installs

- **Status:** Accepted (2026-10-19, the owner's decision). Supersedes the line of 2026-10-16 in [DECISIONS.md](../DECISIONS.md) that root's copy of the installer is changed only by the admin running the installer from the source again ([#473](https://github.com/Kordal/bot-dot/issues/473)).
- **Owning task:** the owner's request of 19 October 2026 ("How to fix it structurally. So it'll never happen again.")

## Context

The admin page's Update runs root's copy of the installer (`BOT_DOT_DIR/bin/install.sh --update`), which the last run of the installer from the source left there. That copy took the compose files from the new image but set up the machine the old way. When #72 gave botdot's server and its Docker helper a runtime of their own (`runsc-uds`), every update from the admin page on a machine installed before it stopped halfway: the new compose asked the account's Docker for a runtime the old installer never wrote, and on hq.botdot.app the accounts stayed on the old version until the admin ran the installer from the source by hand. Any change that needs the installer and the image to change together breaks the same way.

The same day a manual run and the admin page's update ran at once. The older one wrote the account's Docker settings back after the newer one, and the account stopped.

## Decision

- botdot's image carries the installer (`/opt/bot-dot/install.sh`) beside the files of `lib/` it already carried.
- The admin page's update checks the new image's signature with root's copy, as before. Before it changes anything, it reads the installer and the four files of the release check (`signed-image`, `registry`, `release-manifest`, `release-trust`) out of that image. If the installer differs from root's copy, all five replace root's copies and the update goes on in the new installer (`exec`, once: `BOT_DOT_HANDED_OVER`). An image from before this carries no installer, and root's copy goes on as before.
- One installer runs at a time: every run but `--load` holds a lock (`flock` on `BOT_DOT_RUN/install.lock`) and waits for one that holds it. The update root's step runs for the admin page goes on under its step's lock.

## Alternatives

- Keep root's copy as the admin last installed it, and stop the update with "run the installer from the source" when the new version needs a newer one: rejected by the owner. Every change to the installer would need the admin at the machine again.
- Give each account's Docker every runtime any version might name: fixes this one case, not the next change the installer and the image make together.

## Consequences

- Root runs an installer that came in a signed image, not only one the admin ran from the source. The trust is the image's signature: the release key root's copy holds checks the image before anything is read out of it. A release can rotate the key, because the release check it carries replaces root's.
- A self-built image (`make images`) carries the installer of the source it was built from, and an update hands over to it the same way.
- A failed update is still not rolled back. An installer that waits for another says so; root's step waits silently.
