# Play Console: App content answers

The answers for Play Console → Policy → App content, matching the app as built by `bundlePlay` (ADR 172). A change to the app's permissions or to where it sends data changes these answers in the same pull request.

## Privacy policy

`https://github.com/Kordal/bot-dot/blob/main/docs/google-play/privacy.md`

## Ads

No, the app has no ads.

## App access

"All or some functionality is restricted." Add one set of instructions:

- Name: `Demo server`
- Username / password: the demo login (see README.md, step 9)
- Instructions: `botdot connects to the user's own self-hosted server. Tap Connect, enter https://demo.botdot.app and sign in with the username and password above. The demo account has sample bots; message the Chief of Staff to see a bot reply.`

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
- Can users request deletion? **Yes**, deletion URL: `https://github.com/Kordal/bot-dot/blob/main/docs/google-play/delete-account.md`

| Data type | Collected | Shared | Optional | Purpose |
| --- | --- | --- | --- | --- |
| Personal info → Name (the account's name) | Yes | No | No | App functionality, Account management |
| Messages → Other in-app messages | Yes | No | No | App functionality |
| Photos and videos → Photos | Yes | No | Yes | App functionality |
| Files and docs | Yes | No | Yes | App functionality |
| App activity → Other user-generated content (answers on cards, Board, settings) | Yes | No | No | App functionality |

Not collected: location, contacts, calendar, health, financial info, web history, device IDs, crash logs, diagnostics, audio. Processed ephemerally: No. Data is processed by the user's own server, not by the developer.

## Foreground service (Android 14+)

Play Console → App content → Foreground service permissions. Type: **Special use** (`FOREGROUND_SERVICE_SPECIAL_USE`), subtype as in the manifest.

- Description: `botdot keeps one open connection (server-sent events) to the user's own self-hosted botdot server, so a bot's reply or a request that needs the user's approval shows as a notification within seconds. A self-hosted server cannot use Firebase Cloud Messaging without a relay run by the developer, which would route every user's notifications through a third party. The service starts when the user signs in, shows an ongoing notification for as long as it runs, and stops when the user signs out.`
- User impact if deferred: `Notifications would arrive minutes to hours late: approvals a bot waits for would block its work.`
- Video: a 30-second screen recording: sign in, the ongoing notification appears, lock the phone, a bot reply arrives as a notification, tap it, the chat opens.

## Other declarations

- News app: No. Government app: No. Financial features: None. Health: None.
- COVID-19 contact tracing: No. Data safety for kids: not applicable (18+).
