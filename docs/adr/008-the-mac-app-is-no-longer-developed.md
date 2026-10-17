# ADR-008: The Mac app is no longer developed

- **Status:** Superseded by [ADR 022](022-the-mac-app-is-developed-again.md) (2026-10-11); accepted 2026-10-04, the owner's decision
- **Owning task:** none (a decision about scope, not a task's)

## Context

[ADR 0001](0001-native-apps-per-platform.md) made the Mac app a native SwiftUI app and ruled that every new feature goes to the web page, Android and the Mac together. On 4 October 2026 the owner stopped development of the Mac version: only Android and the web page continue.

## Decision

A feature is decided once on the server and drawn twice: on the web page and in the Android app. No task plans, builds or tests Mac work. This supersedes the "web, Android and the Mac together" rule of ADR 0001; its choice of native apps over a shell around the web page stands for Android.

## Alternatives

- **Keep the Mac in step**, as ADR 0001 ruled. Refused by the owner.
- **Update the Mac in batches.** Refused before, in ADR 0001: that is how the old Mac app fell weeks behind.

## Consequences

- The Mac app stays at what it had on 4 October 2026 and falls behind the web page and Android from the next feature on. It keeps working against a newer server as far as the `features` rule allows: it ignores what it doesn't know.
- `macos/` stays in the repository as it is, and nothing changes it. Its stages `mac-build` and `mac-test` leave the resilience gate, so a server change the Mac app does not follow cannot fail a milestone; the targets stay for running by hand.
- The Mac app the server image carries stays as it is: the last one released. Its manual release workflow, `.github/workflows/mac.yml`, stayed at first and was removed on 2026-10-09 with the Mac checks of `tests.yml`, on the owner's decision: no Mac app is released any more.
- [ADR 0002](0002-mac-hosting-in-docker.md) describes the Mac app's own setup of a local server and gains nothing new.
