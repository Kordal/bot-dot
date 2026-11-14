# The iOS app

Native SwiftUI on the Android app's shared data layer ([ADR 242](../docs/adr/242-the-ios-app-is-native-swiftui-on-the-android-apps-shared-kotlin-data-layer.md)): every rule, parser and call to botdot is Kotlin in [`android/shared`](../android/shared), which the app links as `BotdotShared.xcframework` (SKIE turns a Flow into an AsyncSequence and a suspend function into `async`). Swift draws the screens and nothing else.

**Build and test** on a Mac with Xcode, XcodeGen (`brew install xcodegen`), a JDK 21 and the Android SDK (the shared layer is built by Android's Gradle; it finds the SDK as `sdk.dir` in `android/local.properties`, or in `ANDROID_HOME` or `ANDROID_SDK_ROOT`): `make ios` builds the framework (`./gradlew :shared:assembleBotdotSharedReleaseXCFramework`), makes `BotDot.xcodeproj` from `project.yml` (the project is not in git) and builds and tests the app in an iPhone simulator (the first iPhone on iOS 26 or later; `IOS_SIMULATOR=<its UDID>` picks one, `xcrun simctl list devices` shows them). No Apple account is needed: a simulator build is signed ad hoc ("Sign to Run Locally"), so its Keychain and App Group entitlements apply, and a device build is not signed. CI does the same on GitHub's Mac (`.github/workflows/ios.yml`) and keeps a screenshot of the app in the simulator.

**Words** come from the same dictionary as Android's ([ADR 108](../docs/adr/108-the-interface-speaks-english-or-polish-from-one-dictionary-the-server-hands-out.md)): Swift writes `tr("Saved")` (`BotDot/I18n.swift`), which is the shared layer's, and their Polish is in `lib/i18n/pl/android.json` with the Android app's.

**Calling Kotlin from Swift.** A shared `suspend` function the app calls carries `@Throws(Exception::class)`: Kotlin/Native hands Swift only the exceptions a function declares, and any other ends the app (a sign-out without a network did). Add it to each one the app starts calling. A shared type the app hands to its own async calls is marked `@unchecked Sendable` in `BotDot/SharedSendable.swift`.

**A fake botdot for the shared tests.** `Api` takes a Ktor engine of its own (an `internal` constructor), so a test in `android/shared/src/commonTest` answers its requests with Ktor's `MockEngine` (`io.ktor:ktor-client-mock`), on Android's host and in the iOS simulator alike: `NeedsDeskTest` does. It also unblocks the fake-server tests that were skipped earlier.

## Layout

```
project.yml       the Xcode project: the app, its notification extension and its tests; iOS 26 and later
BotDot/           the app (app.botdot): the address and sign-in screens, Home (HomeView: Needs you, the Board's numbers,
                  the bots in the owner's order, drag to reorder, pull to refresh), Needs you (NeedsYouView: the shared
                  layer's cards, NeedsDesk, with their buttons), a bot's chat (ChatView: its replies' Markdown, the live
                  feed, send, Stop, waiting messages, files from Photos and Files, a failed send back in the box), bots
                  drawn by FigureView, and tr()
BotDotNotify/     the notification service extension (app.botdot.notify), empty for now
BotDotTests/      XCTest: Swift reaches the shared layer and gets the Android app's answers
```

The app and its extension share the App Group `group.app.botdot` and a Keychain access group, for the session and what a push needs.
