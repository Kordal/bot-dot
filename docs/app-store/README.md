# Publishing the iOS app on the App Store

How the iOS app ([ADR 242](../adr/242-the-ios-app-is-native-swiftui-on-the-android-apps-shared-kotlin-data-layer.md)) gets from this repository through TestFlight to the App Store and its review ([#1374](https://github.com/ladrok/bot-dot/issues/1374)), in the order the steps are done. The Android app's twin is [docs/google-play](../google-play/README.md). What is here:

| File | What |
| --- | --- |
| [listing-en.md](listing-en.md), [listing-pl.md](listing-pl.md) | The App Store listing texts, English and Polish |
| [connect-answers.md](connect-answers.md) | The answers for App Store Connect: App Privacy, age rating, App Review Information, export compliance, the EU trader status |

The privacy policy and the account deletion page are the site's: `https://botdot.app/privacy` and `https://botdot.app/account-deletion`.

## The build

The upload workflow, its script, the export compliance key and the key's section in [release signatures](../release-signing.md) come with pull request [#1470](https://github.com/ladrok/bot-dot/pull/1470); until it is merged they are not on `main`.

- **Upload:** Actions → iOS release → Run workflow on `main`, with the version (`.github/workflows/ios-release.yml`, #1470; [ios/README.md](../../ios/README.md)). It tests the commit, archives the Release build, signs it with automatic signing and uploads it to App Store Connect; the build number is the run number.
- **Bundle ids:** `app.botdot` (the app, as on Google Play), `app.botdot.notify` (the notification extension), `app.botdot.share` (the share extension), App Group `group.app.botdot`. Automatic signing registers them the first time.
- **Export compliance** is answered in the app itself once #1470 is merged (`ITSAppUsesNonExemptEncryption` false in `ios/project.yml`: only Apple's own encryption), so a build needs no answer in App Store Connect. Without it, every build asks.

## Steps, in order

1. **The Apple Developer account** (the owner): enrolled and active. The team id (ten characters) is in Membership details.
2. **The App Store Connect API key** for the upload: see [release signatures](../release-signing.md), "The iOS app's App Store Connect key" (#1470). Its four secrets go in GitHub → Settings → Environments → `release`.
3. **The push key and the relay** (notifications, [ADR 150](../adr/150-iphone-notifications-go-sealed-through-a-project-relay.md)): Certificates, Identifiers & Profiles → Keys → + → Apple Push Notifications service, download the `.p8` once. It goes on the project's relay (`relay/README.md`), never in this repository or a botdot server. Without the relay the app works, but rings nothing while closed.
4. **Create the app.** App Store Connect → Apps → + → New App: iOS, name `botdot`, primary language English (U.S.), bundle id `app.botdot`, SKU `botdot-ios`, full access.
5. **First build.** Run the iOS release workflow (step "Upload" above). After Apple's processing (10 to 30 minutes) it shows under TestFlight → iOS builds.
6. **Internal testers.** TestFlight → Internal Testing → + → a group "Team", automatic distribution on, add yourself. Install TestFlight on the iPhone and accept the invite. Every later upload reaches the group by itself.
7. **Store listing.** App Store → the version → paste [listing-en.md](listing-en.md); add the Polish localisation with [listing-pl.md](listing-pl.md). Category: Productivity (secondary: Business). Screenshots: 6.9-inch iPhone (1320 × 2868), 3 to 10, from the app on the demo server; **the owner approves them before they are uploaded**.
8. **App Privacy, age rating, trader status.** As [connect-answers.md](connect-answers.md) says. The EU trader / non-trader declaration (Digital Services Act) is the owner's own: App Store Connect asks it once per account under Business.
9. **App Review Information.** The demo server and its demo code, and the notes in [connect-answers.md](connect-answers.md#app-review-information). The owner types the demo code into App Store Connect himself; it is not kept in this repository or in botdot's Vault.
10. **Submit for review.** Add the build to the version, Add for Review, Submit. A first review takes one to three days. Release: manual, so the owner picks the moment.

## Reviewers

Apple's reviewers get the same review demo as Google's ([ADR 216](../adr/216-managed-computers-prepare-in-the-background-and-demo-access-is-explicit.md), [docs/api.md](../api.md#dedicated-review-demo)): a separate managed one-account machine started with a demo code, whose sign-in page takes that code instead of a passkey. Deleting the demo account and "Sign out everywhere" do not touch it, so one reviewer does not lock out the next (#1465, which must be merged before submitting).

## What Apple's guidelines ask of this app

| Guideline | How the app meets it |
| --- | --- |
| 2.1 App completeness | A working demo server and code in App Review Information (step 9) |
| 4.2 Minimum functionality | A native SwiftUI app with chats, Needs you, the Board, files, a share extension and notifications, not a web view |
| 5.1.1(i) Privacy policy | `https://botdot.app/privacy` in App Store Connect (App Privacy → Privacy Policy URL), and inside the app: "Privacy policy" under the address screen, before any sign-in, and as the last row of Settings, both in Safari (`Legal.privacyPolicy` in `ios/BotDot/Screens.swift`) |
| 5.1.1(v) Account deletion | Home's ⋯ menu → Delete account, on a managed account; a self-hosted owner deletes in the admin page |
| 5.1.2(i) Data sent to third-party AI | The full-screen notice before anything goes to the bots (AiNoticeView), in the app and in the share extension |
| 3.1.1 In-app purchase | No purchase in the app and no link or call to action to one. **Kept:** Settings → Subscription opens a managed account's billing page in Safari (ADR 234), shown only on a managed machine. The owner chose to keep it (2026-11-16). Review may reject such a link outside the US; then the row is hidden in the iOS app |
| 4.8 Login services | No third-party or social login: sign-in is a passkey (or the demo code) on the user's own botdot |

## What changes the answers

A new kind of data the app sends, a new third party it talks to, or a new permission changes `ios/BotDot/PrivacyInfo.xcprivacy`, [connect-answers.md](connect-answers.md) and the site's privacy policy in the same pull request, and App Privacy in App Store Connect after it is merged.
