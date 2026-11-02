# ADR-138: The desktop app rings what the server says on the live feed

- **Status:** Accepted
- **Owning task:** [#885](https://github.com/Kordal/bot-dot/issues/885)
- **Amends:** [ADR 137](137-the-desktop-app-is-a-tauri-window-onto-the-front-door.md)

## Context

The desktop app shows the web page in WKWebView and WebView2, where Web Push doesn't work. The Android app makes its notifications from the live feed, by rules written again in Kotlin. The web page's push follows the same rules on the server (`lib/push.js`): what is new, what waits for the owner once by its tag, not while the web page is in use, what rang kept over a restart. A third copy of those rules in Rust would drift as the Mac app's screens did.

## Decision

- **The server says each notification on the feed.** What `lib/push.js` sends as a push is also emitted as `notification` (`{ title, body, target, tag }`, the push's own payload), right after the event that made it, and its end as `notification_closed` (`{ tag }`): a card answered or gone, a chat read in any app, Claude signed in again. `notification-events` in `features` says so. The web page and the Android app ignore both.
- **The app follows the feed of every botdot address it has a session for,** each on a thread of its own for as long as that session lasts, and shows only these two events: it decides nothing about what rings. A notification whose tag is already shown for that address takes its place; the same chat of two botdots is two notifications. A session that ends, or an address removed, takes its notifications with it.
- **Nothing shows for the botdot in the window while a window of the app is in front.** The server already leaves out a reply in a chat on screen, and waiting cards while the page is in use (`webActive`).
- **A connection lost for more than a few seconds starts again without `since`.** What rang while the computer slept or was offline does not ring late; the chats show it as new. A short loss goes on where it stopped. The gap is measured on the wall clock: the Mac's monotonic clock stands still in sleep. A read that waits longer than two pings ends the connection, as it is after sleep.
- **A click brings the window forward and posts `{ type: "open", target }` to its page,** which opens it as a tap on a push does. A click on another botdot's notification enters that botdot on the target's page (`#bot/<id>`, `#needs`, as the service worker opens it). Only the app posts it: the page still has no way into the app.
- **The system's own notifications.** On the Mac the User Notifications framework (`objc2-user-notifications`): the tag is the request's identifier and the target its thread. It needs the installed bundle, so `cargo run` shows none. On Windows the Action Center's toasts (`windows`), under the app's identifier, which the installer's Start menu shortcut carries; a tag longer than Windows takes is shown under its hash.

- **Notifications turned off in the system show in the app's menu** (#899). The Mac asks its question once; a question left unanswered (an update restarted the app under it) is a refusal from then on, without asking again. While the system has them off, the tray's and the menu bar's menu has "Turn on notifications…", which opens the system's settings for the app; the app asks again when its window comes to the front.

## Alternatives

- **The rules again in Rust, from the feed's own events,** as the Android app does. A third copy of rules that change with almost every milestone.
- **A Tauri notification plugin.** On the desktop it can't say what was clicked, nor remove a notification by its tag.
- **Web Push through the system's browser.** The browser would have to stay open, and its notifications would open the browser, not the app.
- **Replay what was missed after sleep.** A Mac that slept for a night would ring a burst of old replies at once.

## Consequences

- The feed keeps a notification among its last 500 events, which is a few more events than before.
- A card that came and went while the computer slept rings nowhere on it; it is in Needs you.
- Windows is written to the toast API without a Windows machine to try it on: it is checked when one is reachable. A click on a toast reaches the app only while it runs.
