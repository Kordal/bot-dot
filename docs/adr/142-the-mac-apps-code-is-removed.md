# ADR-142: The Mac app's code is removed

- **Status:** Accepted (2026-11-03, the owner's decision)
- **Owning task:** [#877](https://github.com/Kordal/bot-dot/issues/877)
- **Supersedes:** [ADR 031](031-the-mac-app-is-stopped-again.md), [ADR 0002](0002-mac-hosting-in-docker.md)
- **Amended by:** [ADR 242](242-the-ios-app-is-native-swiftui-on-the-android-apps-shared-kotlin-data-layer.md) (2026-11-14): the iOS app is native SwiftUI on the Android app's shared Kotlin data layer, so features go to the web page, Android and, once it has caught up, iOS. The Mac app stays removed.

## Context

[ADR 031](031-the-mac-app-is-stopped-again.md) stopped the native SwiftUI Mac app on 18 October 2026 and kept `macos/` in the repository, untested. [ADR 137](137-the-desktop-app-is-a-tauri-window-onto-the-front-door.md) brought the Mac back as the desktop app, a Tauri window onto the web page, and kept `macos/` until that worked. It works now: the desktop app is released for the Mac, signs in through the browser hand-off as `desktop`, and runs a local botdot in a Lima VM ([ADR 136](136-a-local-botdot-runs-the-linux-installer-in-a-vm-of-its-own.md)). The leftovers cost reading time and keep a second hosting path alive in the server: `compose.mac.yaml`, a `mac` platform in the updater, a Mac app download and a Mac hand-off in the front door.

## Decision

The native Mac app and what only it used are removed:

- `macos/` (the app, `BotDotKit`, the Xcode project and its scripts) and the `mac-*` Make targets.
- `compose.mac.yaml` ([ADR 0002](0002-mac-hosting-in-docker.md)'s local botdot server) and the `BOT_DOT_PLATFORM=mac` branches of the updater and the update cleanup. An account's botdot server on a machine (`BOT_DOT_ACCOUNT`) is always updated by the admin.
- `GET /api/app/mac.zip`, `mac` in `GET /api/version` and the `mac-app` feature.
- `mac` as an app that signs in through the browser hand-off: the front door takes the hand-off from the Android and desktop apps. Sessions and feedback stored with `mac` before stay readable.
- The test fixtures that stood in for the Mac app (`test/fixtures/test-server.js`, `test/fixtures/test-front-door.js`) and the tests that read its Swift files.

Kept, because others use them: the front door's one-account mode and its setup key (`npm start`, `BOT_DOT_REACH=local`), the browser hand-off (Android, desktop), running the server directly on macOS for development, and the generic signed release manifest.

## Alternatives

- **Keep `macos/` as ADR 031 left it.** Rejected: it no longer matches the server, nothing checks it, and the desktop app replaces it.
- **Remove only `macos/` and leave the server's Mac paths.** Rejected: they are a second hosting and update path that nothing runs.

## Consequences

- A Mac reaches botdot through the desktop app or the web page.
- Git history keeps the old code.
- Accepted ADRs and archived documents that mention the Mac app stay as they were written.
