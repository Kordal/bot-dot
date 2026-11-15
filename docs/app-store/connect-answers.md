# App Store Connect: the answers

The answers for App Store Connect, matching the app as `ios/project.yml` builds it and its privacy manifests (`ios/BotDot/PrivacyInfo.xcprivacy`, `ios/BotDotShare/PrivacyInfo.xcprivacy`). A change to what the app sends, or to whom, changes these answers in the same pull request. `node --test test/app-store.test.js` checks that App Privacy names every data type the manifests declare.

## Privacy Policy URL

`https://botdot.app/privacy/`

## App Privacy

Data leaves the iPhone only for the botdot server the user signs in to: their own, or a machine that gives them an account (the hosted service is one). Apple counts that as collected by the developer where the developer runs the machine, so it is declared, linked to the user, for App Functionality only, never for tracking.

- Do you or your third-party partners collect data from this app? **Yes.**
- Used for tracking? **No**, for every type. No tracking domains.

| Data type (App Store Connect) | Manifest key | Linked to the user | Tracking | Purpose |
| --- | --- | --- | --- | --- |
| User Content → Other User Content (messages to bots, answers on cards, settings) | `NSPrivacyCollectedDataTypeOtherUserContent` | Yes | No | App Functionality |
| User Content → Photos or Videos (picked or shared into a chat) | `NSPrivacyCollectedDataTypePhotosorVideos` | Yes | No | App Functionality |
| Identifiers → User ID (the account on the botdot) | `NSPrivacyCollectedDataTypeUserID` | Yes | No | App Functionality |

Not collected: contact info, health, financial info, location, sensitive info, contacts, browsing and search history, purchases, usage data, diagnostics, device ID. The push token goes to the user's botdot and, with the sealed notification, through the project's relay to Apple (ADR 150): it is sent to deliver the notification and not kept.

## Age Rating

All questions **None** or **No**, except:

- Unrestricted web access: **No** (links open in Safari).
- User-generated content / messaging: **Yes**, the user chats with their own bots, and with other people of the same botdot in shared rooms and groups.
- AI-generated content: **Yes**, bot replies come from Claude through the user's own botdot.

Then pick the age rating Apple proposes, at least **18+** (the service's terms are for adults).

## App Review Information

- **Sign-in required:** Yes. User name: `demo` (the form has only a code; Apple's field needs a value); password: the review demo code, typed in by the owner. Not kept in this repository or in botdot's Vault.
- **Before submitting:** #1465 (the demo account survives Delete account and Sign out everywhere) is merged and on the demo server.
- **The demo server** must be up at `https://demo.botdot.app` before submitting, installed with `BOT_DOT_DEMO_CODE_SHA256` (ADR 216). The notes below name that address: change both together.
- **Contact:** the owner's name, phone and email.
- **Notes:**

```
botdot is the iPhone app for a botdot server, where the user's AI bots run. The app shows nothing without a server, so we run a separate demo server for review.

1. Open the app, enter the address https://demo.botdot.app and tap Connect.
2. On the sign-in page that opens, enter the code from the password field above under "Demo access code" and tap Open demo. (The page may ask once to accept the terms.)
3. Read the notice about data sent to AI (guideline 5.1.2(i)) and tap Continue.
4. Open the Chief of Staff and send a message: a bot replies in under a minute. Home shows the bots, Needs you and the Board.

Account deletion (5.1.1(v)): Home, the ... menu, Delete account. On the demo account it goes through every step but keeps the account, so the next reviewer can still sign in.

The app has no in-app purchases and sells nothing. Sign-in is a passkey on the user's own server, not a third-party login.
```

## Export Compliance

Answered in the app once #1470 is merged: it sets `ITSAppUsesNonExemptEncryption` false in `ios/project.yml` (the app uses only Apple's encryption: HTTPS, the Keychain, CryptoKit to open a notification's seal), so a build asks nothing. Until then every build asks, with the answers below. If App Store Connect asks anyway: uses encryption **Yes**, qualifies for an exemption **Yes** (only standard encryption within Apple's operating system).

## Content Rights

Does the app contain, show or access third-party content? **No**: what it shows is the user's own bots' work on the user's own server.

## Digital Services Act (EU)

The trader / non-trader status is the owner's own declaration (App Store Connect → Business → the account). The hosted botdot is a paid service, so the expected answer is **trader**, with the address, phone and email that the EU App Store then shows. The owner decides and fills it in.

## Pricing and Availability

Price: **Free**. Availability: all countries and regions where the owner can publish. Not for Apple silicon Macs: off (a Mac uses the desktop app).
