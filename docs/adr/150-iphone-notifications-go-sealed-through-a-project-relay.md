# ADR-150: iPhone notifications go sealed through a project relay

- **Status:** Accepted
- **Owning task:** [#964](https://github.com/Kordal/bot-dot/issues/964) (parent [#961](https://github.com/Kordal/bot-dot/issues/961))
- **Amends:** issue [#87](https://github.com/Kordal/bot-dot/issues/87) ("no relay"), for the iOS app only

## Context

The iOS app (#961) is the desktop app's window on the iPhone: a WKWebView onto the front door. WKWebView has no Web Push, and iOS gives an app no connection while it is closed, so the live feed that rings the desktop app (ADR 138) rings nothing on a phone in a pocket. The only way to wake an iPhone is Apple's push service (APNs), and APNs takes a push only from the holder of the key of the app's Apple team. A self-hosted botdot can't hold that key: it would be the project's key on every server. Web Push needed no relay (#87) because a browser's push service takes a push from whoever holds the subscription's own key.

## Decision

- **The project runs a push relay** (`relay/`, Node with no dependencies, about 200 lines), the one holder of the APNs key. It keeps no accounts and nothing of a push. A botdot posts `{ token, environment, sealed, collapseId, threadId }` to `POST /v1/push`; the relay forwards an alert with a generic text ("botdot" / "New notification"), `mutable-content: 1`, the seal, the collapse id and the thread, over one HTTP/2 connection per environment with a provider token it renews every 40 minutes.
- **The text is sealed for the device alone.** The app makes a random 32-byte key, keeps it in its Keychain (shared with its Notification Service Extension), and gives it to its botdot with its device token (`POST /api/push/apns`). The botdot seals the push's own payload `{ title, body, target, tag }` with AES-256-GCM under that key. The extension opens the seal and shows the real text. The relay and Apple see which device, how big, the tag and the target (ids, no text), never what a bot wrote.
- **What rings is decided once.** Where `lib/push.js` sends a Web Push, it sends the same notification to every registered device: no new rules. The tag is the collapse id, so a newer notification of the same chat or card replaces the older one; the target is the thread.
- **The relay refuses abuse:** a request or a push over 4 KB (`413`), what botdot never sends (`400`), and more than a burst of 30 pushes to one token, then one every 10 s (`429`). Its log has the status and Apple's reason, never a token or a payload.
- **A token Apple calls gone** (`410`, `BadDeviceToken`, `Unregistered`, `DeviceTokenNotForTopic`) comes back as `410`, and the botdot forgets that device, as it drops a Web Push subscription its push service calls gone.
- **The relay's address is a setting of the server** (`BOT_DOT_PUSH_RELAY`, an https address). Unset, nothing goes to APNs, `features` has no `apns-push`, and the route answers `409`. Once the project's relay is up, the address becomes the default, so an admin sets nothing up (#961, story 17).

## Alternatives

- **Each admin brings an APNs key.** Needs an Apple Developer account per server and the app built under each team: no App Store app.
- **The relay sends the text in the clear.** Simpler for the app (no extension), but the project would see every reply of every account.
- **A background connection in the app.** iOS ends it within seconds of the app leaving the screen; no background mode covers a chat feed.
- **Remove a delivered notification by a silent push** when it is read elsewhere. iOS delivers silent pushes when it likes, and not at all to an app the owner swiped away. The app clears its delivered notifications when it opens instead.

## Consequences

- One more service the project runs for every self-hoster, and a single point for iPhone notifications: while it is down, iPhones get none, and the Home Screen web app's Web Push still works.
- Apple and the project learn when an account gets a notification and of which chat (`bot:<id>`), as a browser's push service does for Web Push.
- The key on the botdot server is in `push.json` (readable by botdot alone), beside the Web Push keys, so a backup carries it.
- Nothing rings on an iPhone until the Apple Developer account exists: the APNs key, the bundle ids (`dev.botdot.ios`, `dev.botdot.ios.notify`) and the extension come with it. Until then the relay is tested against a stand-in APNs.
