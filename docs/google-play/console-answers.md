# Play Console: App content answers

The answers for Play Console → Policy → App content, matching the app as built by `bundlePlay` (ADR 173). A change to the app's permissions or to where it sends data changes these answers in the same pull request.

## Privacy policy

`https://botdot.app/privacy` (the site's page, Kordal/botdot-site; the same URL the App Store and the iPhone app name). [privacy.md](privacy.md) is its source here: a change to one changes the other.

## Ads

No, the app has no ads.

## App access

"All or some functionality is restricted." Add one set of instructions:

- Name: `Demo server`
- Username: `demo` (the sign-in page has only a code; Play's field needs a value). Password: the review demo code (ADR 216), typed in by the owner. It is not kept in this repository or in botdot's Vault.
- Instructions: `botdot connects to the user's own botdot server. Open the app, enter https://demo.botdot.app and tap Connect. On the sign-in page, enter the password above under "Demo access code" and tap Open demo. Open the Chief of Staff and send a message: a bot replies in under a minute. Delete account (Settings) goes through every step on the demo account but keeps it, so the next reviewer can still sign in.`
- Before submitting: the demo server runs a release with #1465 (the demo account survives Delete account and Sign out everywhere), installed with `BOT_DOT_DEMO_CODE_SHA256`.

## Content rating (IARC questionnaire)

- Category: **All other app types** (communication tool).
- Violence, sexuality, language, controlled substances, gambling: **No**.
- Users can interact or exchange information: **Yes** (the user chats with their own bots; group chats and shared rooms with other people of the same server exist).
- Shares the user's location: **No**. Allows purchases: **No**.
- Generates content with AI: **Yes**, bot replies come from Claude through the user's own server.

## Target audience and content

- Target age: **18 and over** only. Not designed for children. No appeal to children.

## Data safety

Data that leaves the phone goes only to the server the user signs in to, which the user runs or chooses. Google counts that as collected, so it is declared, never as shared.

- Does the app collect or share user data? **Yes**, collected.
- Is all data encrypted in transit? **Yes** (HTTPS only: the app allows no plain HTTP connection).
- Can users request deletion? **Yes**, deletion URL: `https://botdot.app/account-deletion` (the site's page; [delete-account.md](delete-account.md) is its source here)

| Data type | Collected | Shared | Optional | Purpose |
| --- | --- | --- | --- | --- |
| Personal info → Name (the account's name) | Yes | No | No | App functionality, Account management |
| Messages → Other in-app messages | Yes | No | No | App functionality |
| Photos and videos → Photos | Yes | No | Yes | App functionality |
| Photos and videos → Videos | Yes | No | Yes | App functionality |
| Audio files → Voice or sound recordings, Other audio files | Yes | No | Yes | App functionality |
| Files and docs | Yes | No | Yes | App functionality |
| App activity → Other user-generated content (answers on cards, Board, settings) | Yes | No | No | App functionality |

Videos and audio files are collected only as files the owner attaches to a chat or shares into botdot from another app, through Android's own file picker and share sheet, which take a file of any type; they go to the user's own server like any other file. Attaching is optional, so both are **Optional: Yes**. The app has no camera or microphone code and asks for neither permission (see the manifest), so it records no video and no audio itself: it can only send a recording that already exists on the phone.

Not collected: location, contacts, calendar, health, financial info, web history, device IDs, crash logs, diagnostics, and audio the app records (it records none). Processed ephemerally: No, for every type above, videos and audio files included: the user's server stores what is attached. Data is processed by the user's own server, not by the developer.

## Foreground service (Android 14+)

Play Console → App content → Foreground service permissions. Type: **Special use** (`FOREGROUND_SERVICE_SPECIAL_USE`), subtype as in the manifest.

- Description: `botdot keeps one open connection (server-sent events) to the user's own self-hosted botdot server, so a bot's reply or a request that needs the user's approval shows as a notification within seconds. A self-hosted server cannot use Firebase Cloud Messaging without a relay run by the developer, which would route every user's notifications through a third party. The service starts when the user signs in, shows an ongoing notification for as long as it runs, and stops when the user signs out.`
- User impact if deferred: `Notifications would arrive minutes to hours late: approvals a bot waits for would block its work.`
- Video: a screen recording of under a minute: sign in, the ongoing notification appears, send a message to a bot, lock the phone, the bot's reply arrives as a notification, tap it, the chat opens. Made by the **Play video** workflow ([README](README.md#making-the-foreground-service-video)); upload it to YouTube as Unlisted and paste the link.

## Other declarations

- News app: No. Government app: No. Financial features: None. Health: None.
- COVID-19 contact tracing: No. Data safety for kids: not applicable (18+).
