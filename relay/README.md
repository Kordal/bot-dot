# The push relay

Forwards iPhone notifications, sealed by each botdot server for one device, to Apple's push service with the project's APNs key ([ADR 150](../docs/adr/150-iphone-notifications-go-sealed-through-a-project-relay.md)). Node 22, no dependencies. The request it takes is in `server.js`; the seal is in [docs/api.md](../docs/api.md#notifications-on-this-device).

```sh
APNS_KEY_FILE=AuthKey_XXXXXXXXXX.p8 APNS_KEY_ID=XXXXXXXXXX APNS_TEAM_ID=YYYYYYYYYY node relay/server.js
```

| Variable | |
| --- | --- |
| `APNS_KEY_FILE` or `APNS_KEY` | The APNs auth key (`.p8`), as a file or its text |
| `APNS_KEY_ID` | The key's id (10 characters) |
| `APNS_TEAM_ID` | The Apple team's id |
| `APNS_TOPIC` | The app's bundle id, default `app.botdot` (ios/project.yml) |
| `PORT`, `HOST` | Where it listens, default `0.0.0.0:8787`; put it behind https |

A botdot server sends to it when `BOT_DOT_PUSH_RELAY` is its https address. Tests: `test/push-relay.test.js`, against a stand-in APNs.

## The key, from the Apple Developer account

1. In Certificates, Identifiers & Profiles, Identifiers: the App ID `app.botdot` with the Push Notifications capability (the extension, `app.botdot.notify`, needs none: it only opens what arrives).
2. In Keys, a new key with "Apple Push Notifications service (APNs)" ticked, for both environments ("Sandbox & Production"). Download its `AuthKey_<Key ID>.p8` once: Apple keeps no copy. Its Key ID is beside it; the Team ID is in Membership details.
3. Start the relay with them: `APNS_KEY_FILE`, `APNS_KEY_ID`, `APNS_TEAM_ID`. One key serves both environments: a botdot names each device's (`development` for a build from Xcode, `production` for TestFlight and the App Store), and the relay picks Apple's sandbox or production address by it.
4. Each botdot that sends through it sets `BOT_DOT_PUSH_RELAY` to the relay's https address.
