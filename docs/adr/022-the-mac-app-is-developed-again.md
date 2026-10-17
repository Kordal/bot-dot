# ADR-022: The Mac app is developed again, for the owner's Mac

- **Status:** Accepted (2026-10-11, the owner's decision); its "no GitHub checks" superseded by [ADR 030](030-the-mac-app-is-checked-on-githubs-machines.md) (2026-10-17)
- **Owning task:** [#365](https://github.com/Kordal/bot-dot/issues/365)

## Context

[ADR 008](008-the-mac-app-is-no-longer-developed.md) stopped the Mac app on 4 October 2026: features went to the web page and the Android app only, and `macos/` was left as it was. The Mac app kept what Milestones 1 to 4 gave it while Milestones 5 to 10 went by. On 11 October 2026 the owner decided that the Mac app is developed again and gets every new feature together with the web page and the Android app.

## Decision

A feature is decided once on the server and drawn three times: on the web page, in the Android app and in the Mac app. This supersedes ADR 008 and restores the "web, Android and the Mac together" rule of [ADR 0001](0001-native-apps-per-platform.md).

The Mac app is not released yet. It is built from the repository for the owner's own Mac: no published build, no signing for others and no GitHub checks. GitHub's Mac runners cost ten times the Linux ones on a private repository, so the Mac build and the tests of its data layer are local checks, run on a developer's Mac (`make mac-build`, `make mac-test`).

## Alternatives

- **Keep the Mac app stopped,** as ADR 008 ruled. Refused by the owner.
- **Bring the Mac app up to date once and stop again.** Refused: the owner said the Mac is back for good, and an app updated in batches is how the old Mac app fell weeks behind (ADR 0001).
- **Run the Mac checks on GitHub.** Not now: the cost named above, for an app only its owner runs. A change that breaks the Mac app is caught on the developer's Mac, or not until someone runs the checks there.

## Consequences

- The Mac app first catches up with Milestones 5 to 10 (issues #366 to #375), following the behaviour and the words of the Android app inside its own layout. Until those are done it lacks what they name.
- A task that changes what the apps show plans, builds and tests the Mac app with the web page and Android. Its Mac part is checked with `make mac-build` and `make mac-test`, which need the full Xcode and nothing from GitHub.
- No workflow builds, tests or publishes the Mac app. The server image carried the last one released until 2026-10-14 and carries none since ([DECISIONS](../DECISIONS.md)); the owner's Mac gets a newer one from the repository.
- [ADR 0002](0002-mac-hosting-in-docker.md) stands: the Mac app sets up and looks after a botdot server on the same Mac, in Docker.
- Publishing the Mac app, signing it for others and GitHub checks for it are a later decision, with an ADR of their own.
