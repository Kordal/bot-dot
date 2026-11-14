# The iOS app

Native SwiftUI on the Android app's shared data layer ([ADR 242](../docs/adr/242-the-ios-app-is-native-swiftui-on-the-android-apps-shared-kotlin-data-layer.md)): every rule, parser and call to botdot is Kotlin in [`android/shared`](../android/shared), which the app links as `BotdotShared.xcframework` (SKIE turns a Flow into an AsyncSequence and a suspend function into `async`). Swift draws the screens and nothing else.

**Build and test** on a Mac with Xcode, XcodeGen (`brew install xcodegen`), a JDK 21 and the Android SDK (the shared layer is built by Android's Gradle; it finds the SDK as `sdk.dir` in `android/local.properties`, or in `ANDROID_HOME` or `ANDROID_SDK_ROOT`): `make ios` builds the framework (`./gradlew :shared:assembleBotdotSharedReleaseXCFramework`), makes `BotDot.xcodeproj` from `project.yml` (the project is not in git) and builds and tests the app in an iPhone simulator (the first iPhone on iOS 26 or later; `IOS_SIMULATOR=<its UDID>` picks one, `xcrun simctl list devices` shows them). Nothing is signed: no Apple account is needed for the simulator. CI does the same on GitHub's Mac (`.github/workflows/ios.yml`) and keeps a screenshot of the app in the simulator.

**Words** come from the same dictionary as Android's ([ADR 108](../docs/adr/108-the-interface-speaks-english-or-polish-from-one-dictionary-the-server-hands-out.md)): Swift writes `tr("Saved")` (`BotDot/I18n.swift`), which is the shared layer's, and their Polish is in `lib/i18n/pl/android.json` with the Android app's.

## Layout

```
project.yml       the Xcode project: the app, its notification extension and its tests; iOS 26 and later
BotDot/           the app (app.botdot): its screens, and tr()
BotDotNotify/     the notification service extension (app.botdot.notify), empty for now
BotDotTests/      XCTest: Swift reaches the shared layer and gets the Android app's answers
```

The app and its extension share the App Group `group.app.botdot` and a Keychain access group, for the session and what a push needs.
