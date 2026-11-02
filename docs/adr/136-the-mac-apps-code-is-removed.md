# ADR-136: The Mac app's code is removed

- **Status:** Accepted (2026-11-02, the owner's decision)
- **Owning task:** [#877](https://github.com/Kordal/bot-dot/issues/877)
- **Supersedes:** [ADR 031](031-the-mac-app-is-stopped-again.md), [ADR 0002](0002-mac-hosting-in-docker.md)

## Context

[ADR 031](031-the-mac-app-is-stopped-again.md) stopped the native SwiftUI Mac app on 18 October 2026 and kept `macos/` in the repository, untested, in case the app came back. Since then every milestone has gone to the web page and Android only, so the app falls further behind with each merge. A desktop app, if one comes, is planned as a thin shell around the web page, which needs none of the SwiftUI code. Meanwhile the leftovers cost reading time and keep a second hosting path alive in the server: `compose.mac.yaml`, a `mac` platform in the updater, a Mac app download and a Mac hand-off in the front door.

## Decision

The native Mac app and what only it used are removed:

- `macos/` (the app, `BotDotKit`, the Xcode project and its scripts) and the `mac-*` Make targets.
- `compose.mac.yaml` ([ADR 0002](0002-mac-hosting-in-docker.md)'s local botdot server) and the `BOT_DOT_PLATFORM=mac` branches of the updater and the update cleanup. An account's botdot server on a machine (`BOT_DOT_ACCOUNT`) is always updated by the admin.
- `GET /api/app/mac.zip`, `mac` in `GET /api/version` and the `mac-app` feature.
- `mac` as an app that signs in through the browser hand-off: the front door takes the hand-off from the Android app only. Sessions and feedback stored with `mac` before stay readable.
- The test fixtures that stood in for the Mac app (`test/fixtures/test-server.js`, `test/fixtures/test-front-door.js`) and the tests that read its Swift files.

Kept, because others use them: the front door's one-account mode and its setup key (`npm start`), the browser hand-off (Android), running the server directly on macOS for development, and the generic signed release manifest.

## Alternatives

- **Keep `macos/` as ADR 031 left it.** Rejected: it no longer matches the server, nothing checks it, and a future desktop app would not start from it.
- **Remove only `macos/` and leave the server's Mac paths.** Rejected: they are a second hosting and update path that nothing runs.

## Consequences

- A Mac reaches botdot through the web page, which installs as an app in Chrome, Edge or Safari.
- Bringing a Mac app back is a new decision with an ADR of its own. Git history keeps the old code.
- Accepted ADRs and archived documents that mention the Mac app stay as they were written.
