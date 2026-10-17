# Native apps per platform, not a shell around the web page

> [ADR 008](008-the-mac-app-is-no-longer-developed.md) stopped the Mac app on 2026-10-04; [ADR 022](022-the-mac-app-is-developed-again.md) restored this decision on 2026-10-11: features go to the web page, Android and the Mac together.

The Mac app (and the iOS app to come) is built natively in SwiftUI, screen for screen like the web page, rather than as a WKWebView shell that loads the botdot server's web UI. We chose this for a real Mac feel, including Apple's Liquid Glass design, and accepted the cost: every web feature has to be built again in Swift. To keep that cost from turning into drift again (the old Mac app fell weeks behind when it was updated in batches), each new feature now goes to the web, Android and the Mac together. The old `macos/` app was removed and rewritten from scratch rather than caught up.

## Considered Options

- **A WKWebView shell** with native parts only for the menu bar, notifications and setup. It would have been small and could never fall behind, but inside the window it would not be a Mac app.
- **One multiplatform SwiftUI codebase for Mac and iOS from the start.** We rejected this for now because it is more work up front, and iOS has to wait for an Apple developer account anyway.
