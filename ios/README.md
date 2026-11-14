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
                  layer's cards, NeedsDesk, with their buttons), the Board (BoardView: BoardDesk's tiles and taps), the
                  account's parts (AccountViews: Delete account, Feedback, What's new, the paused account), bots drawn
                  by FigureView, and tr()
BotDotNotify/     the notification service extension (app.botdot.notify), empty for now
BotDotTests/      XCTest: Swift reaches the shared layer and gets the Android app's answers
```

The app and its extension share the App Group `group.app.botdot` and a Keychain access group, for the session and what a push needs.

## Android's screens on iOS

Every screen of the Android app (`android/app/src/main/java/dev/botdot/app/ui/*Screen.kt`, the routes of `MainActivity`'s
NavHost, its settings panels and its dialogs), and the iOS view that draws it or the ticket of [#1355](https://github.com/Kordal/bot-dot/issues/1355)
that builds it. A screen added on Android adds its row here. "Left" is part of #1372 that is not built yet.

| Android | Opened from | iOS |
| --- | --- | --- |
| `ConnectScreen` (`connect`) | first run, ⋯ | `AddressView` |
| `SignInScreen` (`sign-in`) | the front door asks | `SignInView` |
| `PausedScreen` (`paused`) | an account the admin paused | `PausedView` |
| `HomeScreen` (`home`), `HomeParts` | start | `HomeView` |
| `NeedsYouScreen` (`needs`) | Home's Needs you, the Board | `NeedsYouView` |
| `DashboardScreen` (`dashboard`), `TileBlocks`, `BlockKit` | Home's Board cards | `BoardView` (no drag to move, colour wheel, table or picture blocks yet) |
| `HomeTilesSheet` | holding Home's Board cards | left (#1372) |
| `WhatsNewDialog` | after an update | `WhatsNewView` |
| `FeedbackDialog` | Home's ⋯ | `FeedbackView` |
| `ChiefNameQuestion` | the first run | the alert in `HomeView` |
| `SettingsScreen`: Delete account | Settings | `AccountDeletionView`, from Home's ⋯ until Settings is there |
| `RoomsScreens`: `RoomsScreen`, `RoomChatScreen`, `RoomSettingsScreen` (`rooms`, `room/{id}`, `room/{id}/settings`) | Home's Rooms row | left (#1372) |
| `CompanyScreen` (`company`) with `CompanyHome`, `CompanyAbout`, `CompanyTeam`, `CompanyGoals`, `CompanyTodo`, `CompanyCalendar` | a project's space | left (#1372; the project's page and its setup, which #1366's projects open) |
| `ProjectTree`, `ProjectSettings`, `ProjectOverview`, `ProjectCardsRow`, `ProjectChatSheet`, `ProjectCreation` | the spaces | #1366 |
| `BotChatScreen` (`bot/{id}`) | Home's rows | #1361 |
| `ChiefScreen` (`chief/{id}`) | Home | #1362 |
| `GroupChatScreen` (`group/{id}`), `GroupSettingsScreen` | Home's group rows | #1367 |
| `FilesScreen` (`files/{id}`), `DocumentViewer` | chats, settings | #1368 |
| `VaultScreen` (`vault`) | Settings | #1369 |
| `SettingsScreen` (`settings`), `BotSettingsScreen`, `ChiefSettingsScreen`, `JobsScreen`, `SkillsConnectorsScreens` (`skills`, `connectors`), `PagesScreen` (`pages`), `StorageScreen` (`storage`), `KeypadView` | Home, a chat's settings | #1370 |
| `LiveScreen`, `BoatScreen` (`screen/{id}`) | a bot's settings | #1371 |
| `ShareScreen` (`share`) | another app's Share | #1373 |
| `AppUpdateRow` | Home, Settings | none: the App Store updates the iPhone app |
