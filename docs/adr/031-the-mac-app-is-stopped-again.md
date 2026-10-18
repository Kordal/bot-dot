# ADR-031: The Mac app is stopped again

- **Status:** Accepted (2026-10-18, the owner's decision)
- **Owning task:** [#7](https://github.com/Kordal/bot-dot/issues/7)

## Context

[ADR 022](022-the-mac-app-is-developed-again.md) brought the Mac app back on 11 October 2026, and [ADR 030](030-the-mac-app-is-checked-on-githubs-machines.md) gave it checks on GitHub's macOS machines. The Mac app was still catching up with Milestones 5 to 10, and its checks on GitHub's machines failed on tests that need Docker, which those machines lack. On 18 October 2026 the owner decided to drop the Mac app for now and focus on the web page and the Android app.

## Decision

New work covers the web page and the Android app only, as under [ADR 008](008-the-mac-app-is-no-longer-developed.md). No workflow builds or tests the Mac app: the Tests workflow has no `mac` job. `macos/` stays in the repository as it is, with the local `make mac-build`, `make mac-test` and `make mac-install` targets, and the README no longer offers the Mac app. This supersedes ADR 022 and ADR 030.

## Alternatives

- **Keep the Mac app and its checks.** Refused by the owner.
- **Delete `macos/`.** Not now: the app may come back, and the code costs nothing while no check runs it.

## Consequences

- A task that changes what the apps show plans, builds and tests the web page and Android only. A change can break the Mac app unseen.
- A Mac reaches botdot through the web page, as any other computer does. [ADR 0002](0002-mac-hosting-in-docker.md)'s Mac hosting is not offered while the app is stopped.
- Bringing the Mac app back is a later decision, with an ADR of its own.
