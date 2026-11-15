# The iOS app

Native SwiftUI on the Android app's shared data layer ([ADR 242](../docs/adr/242-the-ios-app-is-native-swiftui-on-the-android-apps-shared-kotlin-data-layer.md)): every rule, parser and call to botdot is Kotlin in [`android/shared`](../android/shared), which the app links as `BotdotShared.xcframework` (SKIE turns a Flow into an AsyncSequence and a suspend function into `async`). Swift draws the screens and nothing else.

**Build and test** on a Mac with Xcode, XcodeGen (`brew install xcodegen`), a JDK 21 and the Android SDK (the shared layer is built by Android's Gradle; it finds the SDK as `sdk.dir` in `android/local.properties`, or in `ANDROID_HOME` or `ANDROID_SDK_ROOT`): `make ios` builds the framework (`./gradlew :shared:assembleBotdotSharedDebugXCFramework`, a Debug build: it links in seconds where Release takes minutes), makes `BotDot.xcodeproj` from `project.yml` (the project is not in git) and builds and tests the app in an iPhone simulator (the first iPhone on iOS 26 or later; `IOS_SIMULATOR=<its UDID>` picks one, `xcrun simctl list devices` shows them). No Apple account is needed: a simulator build is signed ad hoc ("Sign to Run Locally"), so its Keychain and App Group entitlements apply, and a device build is not signed. CI does the same on GitHub's Mac (`.github/workflows/ios.yml`) and keeps a screenshot of the app in the simulator.

**Words** come from the same dictionary as Android's ([ADR 108](../docs/adr/108-the-interface-speaks-english-or-polish-from-one-dictionary-the-server-hands-out.md)): Swift writes `tr("Saved")` (`BotDot/I18n.swift`), which is the shared layer's, and their Polish is in `lib/i18n/pl/android.json` with the Android app's.

**Calling Kotlin from Swift.** A shared `suspend` function the app calls carries `@Throws(Exception::class)`: Kotlin/Native hands Swift only the exceptions a function declares, and any other ends the app (a sign-out without a network did). Add it to each one the app starts calling. A shared type the app hands to its own async calls is marked `@unchecked Sendable` in `BotDot/SharedSendable.swift`.

**A fake botdot for the shared tests.** `Api` takes a Ktor engine of its own (an `internal` constructor), so a test in `android/shared/src/commonTest` answers its requests with Ktor's `MockEngine` (`io.ktor:ktor-client-mock`), on Android's host and in the iOS simulator alike: `NeedsDeskTest` does. It also unblocks the fake-server tests that were skipped earlier.

## Layout

```
project.yml       the Xcode project: the app, its notification extension and its tests; iOS 26 and later
BotDot/           the app (app.botdot): the address and sign-in screens, Home (HomeView: Needs you, with Allow and No
                  on a permission, the Board's numbers, the bots in the owner's order, a category folded by a tap on its
                  heading, drag to reorder, pull to refresh), Needs you (NeedsYouView: the shared
                  layer's cards, NeedsDesk, with their buttons), a bot's chat (ChatView: its replies' Markdown, the live
                  feed, send, Stop, waiting messages, files from Photos and Files, a failed send back in the box; a file
                  path in a reply opens in the viewer, MarkdownView(paths:); quick-answer choices and question boxes,
                  QuestionsBox, under the reply that asks, each answering its run), the Chief's chat (ChiefView: its
                  conversations, what each message is about, 👍/👎 under the Chief's unasked messages, a bot's
                  suggestion with Approve and Decline, question boxes under its newest reply), one message box for all
                  (Composer), a group's chat (GroupChatView: each member's reply under its own name, a tapped answer
                  with its question above it, the members at work with Stop all, who is next, Go on, waiting messages,
                  the plan dock, question boxes; its title opens the members panel, GroupPanelView: name, members,
                  notes, delete); in all three a reply's pictures show as themselves and its other files as chips,
                  each opening in the viewer (ReplyFilesView, the shared ReplyFiles),
                  Passwords (VaultView, from Home's ⋯ menu: the entries in their categories, which fold, a search over
                  a list longer than eight, a login's editor, Bitwarden's unlock), Files (FilesView, from Home's ⋯
                  menu: a bot's or the Chief's places and folders, sort, search, upload from Photos or Files, a new
                  folder, rename, keep in mind, share, delete), the document viewer (ViewerView: text and code with line
                  numbers, a CSV as a table, the rest in QuickLook), a bot's computer screen (ScreenView: the shared
                  layer's ScreenStore, noVNC in a WKWebView with the session's cookie, Take control and I'm done, opened
                  from Home's ⋯ menu), a bot's settings (BotSettingsView: icon, colour, name, assignment, pinned, its
                  Browser on a server from before every bot has a computer, its skills, other bots asking it, shared
                  rooms and who may mention it, Undo last change, its key, with Advanced its model; BotSettingsDesk
                  saves each change by itself), Settings (SettingsView:
                  Apps, models, language, Usage, Claude, Updates with What's new, the Subscription of a managed account,
                  Advanced, the address; AppSettingsDesk), Apps (AppsView: the Composio key, the connected apps and who
                  uses them, search, Connect opening the sign-in in Safari; AppsDesk), the status keypad (KeypadView:
                  the shared Keypad's pages, digits and pills), the Board (BoardView: BoardDesk's tiles and taps), shared
                  rooms (RoomsView: RoomsDesk's list, a room's chat and its settings), the account's parts (AccountViews:
                  Delete account, Feedback, the paused account), What's new once after an update (WhatsNewSheet),
                  projects (ProjectView, from Home's switch of spaces: a project's page with its board (with overview-board
                  also Needs you, Current work, Blockers and Latest replies as its tiles, ADR 245, and its teams behind
                  Team, ADR 238), its cards, Tidy,
                  its teams with the lead first and their panel and chat, its own bots with Add bot, the Files tile and
                  its default chat; ProjectSettingsView behind the gear: name, colour, site or idea, sources (a link
                  or files added, one taken off), the folder with Open, the Vault logins, Project Manager, the teams
                  (New team; Edit: name, bots, lead, Delete team), ✕ and Add bot, project updates or each lead's
                  report rhythm and the morning standup, Never without asking, Time, Archive and Delete project),
                  bots drawn by FigureView, and tr(). Home's ⋯ menu opens Settings, Apps, the keypad, each bot's
                  settings, Feedback and Delete account
BotDotNotify/     the notification service extension (app.botdot.notify): opens a push's seal (Seal.swift, CryptoKit) with the
                  key in the shared Keychain group (PushKey.swift) and shows botdot's words and buttons; no shared layer
BotDotTests/      XCTest: Swift reaches the shared layer and gets the Android app's answers, a project's board draws; the
                  extension's opener reads the seals the server made (test/fixtures/push-seals.json)
```

The app and its extension share the App Group `group.app.botdot` and a Keychain access group, for the session and what a push needs.

## Notifications

ADR 150: a botdot that announces `apns-push` (its push relay is set) gets this phone's APNs token and a 32-byte key the app makes and keeps in the shared Keychain group (`POST /api/push/apns`, after the permission, asked when Home first shows such a botdot). Each push comes through the project's relay as "botdot" / "New notification" with a seal; the extension opens it and shows the real title and body, with the buttons the server named (`buttons`: Reply on a chat's, Decline and Approve on a card's), registered as a category of their own. A tap or a button goes to `Notifications.swift`, which asks the shared layer (`PushNotices`) what it opens and sends: a chat (the hook `AppModel.chatToOpen`, for the chat screen), else Home, where Needs you is. Opening the app clears what was delivered. Signing out removes the device.

A simulator gets no push from Apple without the team's key. `xcrun simctl push <udid> app.botdot <payload.json>` delivers one as the relay sends it (`{ "aps": { "alert": …, "mutable-content": 1, "thread-id": … }, "sealed": … }`), and the extension opens it when the seal was made with this simulator's key. A real device build needs the App ID `app.botdot` with Push Notifications and a provisioning profile with `aps-environment` (relay/README.md).

## Android's screens on iOS

Every screen of the Android app (`android/app/src/main/java/dev/botdot/app/ui/*Screen.kt`, the routes of `MainActivity`'s
NavHost, its settings panels and its dialogs), and the iOS view that draws it or the ticket of [#1355](https://github.com/Kordal/bot-dot/issues/1355)
that builds it. A screen added on Android adds its row here. "Left" is part of #1372 that is not built yet.

| Android | Opened from | iOS |
| --- | --- | --- |
| `ConnectScreen` (`connect`) | first run, ⋯ | `AddressView` |
| `SignInScreen` (`sign-in`) | the front door asks | `SignInView` |
| `PausedScreen` (`paused`) | an account the admin paused | `PausedView` |
| `HomeScreen` (`home`), `HomeParts` | start | `HomeView`, with search |
| `NeedsYouScreen` (`needs`) | Home's Needs you, the Board | `NeedsYouView` |
| `DashboardScreen` (`dashboard`), `TileBlocks`, `BlockKit` | Home's Board cards | `BoardView` with the colour wheel (`ColorWheel`) (left: drag to move, table and picture blocks) |
| `InteractivePage`, `PageBlocks` | a page tile, a chat's page link | `ViewerView`: a page in Markdown, an interactive page in its own isolated frame with Full screen, Versions and Download (`InteractivePageView`) (left: a chat's page links, page blocks) |
| `HomeTilesSheet` | holding Home's Board cards | `HomeTilesView` |
| `WhatsNewDialog` | after an update | `WhatsNewSheet` |
| `FeedbackDialog` | Home's ⋯ | `FeedbackView` |
| `ChiefNameQuestion` | the first run | the alert in `HomeView` |
| `SettingsScreen`: Delete account | Settings | `AccountDeletionView`, from Home's ⋯ until Settings is there |
| `RoomsScreens`: `RoomsScreen`, `RoomChatScreen`, `RoomSettingsScreen` (`rooms`, `room/{id}`, `room/{id}/settings`) | Home's Rooms row | `RoomsView`, `RoomChatView`, `RoomSettingsView` |
| `CompanyScreen` (`company`) with `CompanyHome`, `CompanyAbout`, `CompanyTeam`, `CompanyGoals`, `CompanyTodo`, `CompanyCalendar` | a project's space | left (#1372; the project's page and its setup, which #1366's projects open) |
| `SpaceSwitch` (the rail and sheet of spaces), `ProjectTree`, `ProjectSettings`, `ProjectOverview`, `ProjectCardsRow`, `ProjectChatSheet`, `ProjectCreation` | the spaces | `ProjectView` (with overview-board the Overview's tiles on its board and the teams under Team, `ProjectTeamView`, ADR 238), its Overview page (`ProjectOverviewView`, without it), `ProjectSettingsView`, `CompanySetupView` (left: the board canvas) |
| `BotChatScreen` (`bot/{id}`) | Home's rows | `ChatView`: Reply to a task, "@" mentions and Quote, Steer (left: a task's steps, page chips, "Learned" chips) |
| `PlanDock` | a chat at work | `ChatPlanDock` in a bot's chat and the Chief's, `PlanDock` in `GroupChatView` |
| `ChiefScreen` (`chief/{id}`) | Home | `ChiefView`, with the mail draft card and its action chips (`MailCardView`) and the questions' quick answers |
| `GroupChatScreen` (`group/{id}`), `GroupSettingsScreen` | Home's group rows | `GroupChatView`, `GroupPanelView`; a new group from a bot's chat, its "+" (`NewGroupSheet`) |
| `FilesScreen` (`files/{id}`), `DocumentViewer` | chats, settings, Home's ⋯ | `FilesView` with Move to… and Copy to… (`CarryView`), `ViewerView` with Export…, Keep up to date and On Board on a page (`PageBarView`) (left: Export to Google Docs) |
| `VaultScreen` (`vault`) | Settings | `VaultView`, from Home's ⋯ |
| `SettingsScreen` (`settings`), `BotSettingsScreen`, `ChiefSettingsScreen`, `JobsScreen`, `SkillsConnectorsScreens` (`skills`, `connectors`), `PagesScreen` (`pages`), `StorageScreen` (`storage`), `KeypadView` | Home, a chat's settings | `SettingsView`, `BotSettingsView`, `KeypadView`, a bot's scheduled jobs (`JobsView`), every bot's pages (`PagesView`), a bot's Apps and Pages in its settings, Duplicate in a bot's settings (`DuplicateSheet`), Skills (`SkillsView`), Storage (`StorageView`; not yet its Ask the Chief), the Chief's settings behind its chat's gear (`ChiefSettingsView`; not yet its files) (left: in a bot's settings where its computer is and its proxy, always-approved rules) |
| `LiveScreen`, `BoatScreen` (`screen/{id}`) | a bot's settings, Home's ⋯ | `ScreenView` |
| `ShareScreen` (`share`) | another app's Share | `BotDotShare`, the share extension |
| `AppUpdateRow` | Home, Settings | none: the App Store updates the iPhone app |
