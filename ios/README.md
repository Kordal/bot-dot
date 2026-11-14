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
                  feed, send, Stop, waiting messages, files from Photos and Files, a failed send back in the box; a file
                  path in a reply opens in the viewer, MarkdownView(paths:)), a group's chat (GroupChatView: each
                  member's reply under its own name, a tapped answer with its question above it, the members at work
                  with Stop all, who is next, Go on, waiting messages; its title opens the members panel,
                  GroupPanelView: name, members, notes, delete), Passwords (VaultView, from Home's ⋯ menu: the entries
                  in their categories, which fold, a search over a list longer than eight, a login's editor,
                  Bitwarden's unlock), Files (FilesView, from Home's ⋯ menu: a bot's or the Chief's places and folders,
                  sort, search, upload from Photos or Files, a new folder, rename, keep in mind, share, delete), the
                  document viewer (ViewerView: text and code with line numbers, a CSV as a table, the rest in
                  QuickLook), bots drawn by FigureView, and tr()
BotDotNotify/     the notification service extension (app.botdot.notify): opens a push's seal (Seal.swift, CryptoKit) with the
                  key in the shared Keychain group (PushKey.swift) and shows botdot's words and buttons; no shared layer
BotDotTests/      XCTest: Swift reaches the shared layer and gets the Android app's answers; the extension's opener reads
                  the seals the server made (test/fixtures/push-seals.json)
```

The app and its extension share the App Group `group.app.botdot` and a Keychain access group, for the session and what a push needs.

## Notifications

ADR 150: a botdot that announces `apns-push` (its push relay is set) gets this phone's APNs token and a 32-byte key the app makes and keeps in the shared Keychain group (`POST /api/push/apns`, after the permission, asked when Home first shows such a botdot). Each push comes through the project's relay as "botdot" / "New notification" with a seal; the extension opens it and shows the real title and body, with the buttons the server named (`buttons`: Reply on a chat's, Decline and Approve on a card's), registered as a category of their own. A tap or a button goes to `Notifications.swift`, which asks the shared layer (`PushNotices`) what it opens and sends: a chat (the hook `AppModel.chatToOpen`, for the chat screen), else Home, where Needs you is. Opening the app clears what was delivered. Signing out removes the device.

A simulator gets no push from Apple without the team's key. `xcrun simctl push <udid> app.botdot <payload.json>` delivers one as the relay sends it (`{ "aps": { "alert": …, "mutable-content": 1, "thread-id": … }, "sealed": … }`), and the extension opens it when the seal was made with this simulator's key. A real device build needs the App ID `app.botdot` with Push Notifications and a provisioning profile with `aps-environment` (relay/README.md).
