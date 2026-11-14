# ADR-242: The iOS app is native SwiftUI, on the Android app's shared Kotlin data layer

- **Status:** Accepted (2026-11-14, the owner's decision)
- **Owning task:** [#1356](https://github.com/Kordal/bot-dot/issues/1356), spec [#1355](https://github.com/Kordal/bot-dot/issues/1355)
- **Supersedes:** [ADR 151](151-the-ios-app-is-the-desktop-apps-window-on-the-iphone.md)
- **Amends:** [ADR 0001](0001-native-apps-per-platform.md), [ADR 142](142-the-mac-apps-code-is-removed.md)

## Context

ADR 151 made the iOS app the desktop app's Tauri window on the iPhone, to avoid a third drawing of every screen. The owner wants the best user experience on the phone above that saving. A WKWebView window can't give the system's text input, scrolling, gestures, Liquid Glass, VoiceOver, widgets or a share extension as a native app does, and it risks App Store rule 4.2 (a web wrapper). The Android app is native (about 38k lines of Kotlin), and its data layer (`data/`, 76 files, 9 of them using Android APIs) holds the logic a second phone app would need again.

## Decision

- **The iOS app is a native SwiftUI app** in `ios/`, its Xcode project made by XcodeGen from `ios/project.yml` (kept in git; the `.xcodeproj` is not).
- **Its logic is the Android app's.** The Android data layer moves to a Kotlin Multiplatform module, `android/shared`, which iOS gets as an XCFramework. No parsing, rules or calls to the server are written in Swift or Compose: they live in `shared`, once for both phones.
- **A feature is decided once on the server and drawn on the web page, Android and iOS.** Until the iOS app has every Android screen (#1355, phase 2), a change to an Android screen is noted on the iOS catch-up issue; after that, a phone feature changes Android and iOS in the same pull request.
- **The Tauri iOS target is removed** from `desktop/`: its iOS configuration, sign-in sheet, Keychain store, mobile-only branches and the simulator workflow. `desktop/` is the desktop app again (ADR 137, ADR 170).
- **What the server already has for iOS stays:** the APNs relay and its route (ADR 150), `app=ios` in the front door's hand-off (#965), and the web page's iPhone fixes for Safari and the Home Screen (#963).

## Alternatives

- **Keep the Tauri window (ADR 151).** No third drawing, but the weakest experience on the phone, which is what the owner ranks first.
- **Compose Multiplatform,** the Android screens themselves on iOS. Least work and no parity cost, but its text input, scrolling and system integration are emulated, not the system's.
- **SwiftUI with its own Swift data layer.** The same experience as this decision, with every rule and parser written and tested twice.

## Consequences

- Every phone feature costs a second screen (about 20-30% more work per feature), not a second copy of its logic.
- Building and testing the iOS app needs a Mac: CI on GitHub's macOS runners, or the owner's Mac.
- Moving `data/` to `shared` touches most of the Android app at once, so it lands in small pull requests with no behavior change.
- Push on a device, TestFlight and the App Store wait for the Apple Developer account, as before.
