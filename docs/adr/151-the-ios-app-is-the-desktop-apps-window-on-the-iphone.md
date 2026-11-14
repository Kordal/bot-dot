# ADR-151: The iOS app is the desktop app's window, on the iPhone

- **Status:** Superseded by [ADR 242](242-the-ios-app-is-native-swiftui-on-the-android-apps-shared-kotlin-data-layer.md) (2026-11-14)
- **Owning task:** [#962](https://github.com/Kordal/bot-dot/issues/962), spec [#961](https://github.com/Kordal/bot-dot/issues/961)
- **Amends:** [ADR 0001](0001-native-apps-per-platform.md), [ADR 137](137-the-desktop-app-is-a-tauri-window-onto-the-front-door.md)

## Context

An owner with an iPhone reaches botdot in Safari or as a web app on the Home Screen. There is no app to install, and the web app's notifications can't be answered or opened from another app's share sheet. A native iPhone app drawn in SwiftUI would be a third drawing of every screen: the Mac app was stopped twice for that, and its code is gone (ADR 142). The desktop app already shows the front door's web page in WKWebView on the Mac.

## Decision

- **The iOS app is the iOS target of the Tauri project in `desktop/`,** not a project of its own. The app is the project's library (`run()` in `lib.rs`), which the desktop's binary and the iOS app both start. Its bundle identifier is `dev.botdot.ios` (`tauri.ios.conf.json`).
- **It is the same window onto the front door's web page,** with the same screen that asks for an address. A feature is still decided once on the server and drawn twice (web and Android); the iOS app, like the desktop app, is not a third drawing.
- **What only a desktop has stays on the desktop:** the tray and the menus, "Open at login", one app at a time, the updater, the window's size and place, and botdot on the computer itself (ADR 136). On iOS the code of these is not built (`cfg(desktop)`), and their crates are not dependencies there.
- **On iOS an address is `https` only.** A phone runs no botdot, so `http` on the device itself means nothing there.
- **A page on iOS can't open a window of its own** (wry has none on iOS). A link with `target="_blank"`, or `window.open` with an address, goes in the window itself, where a link to another site is sent to Safari as on the desktop (`left_door`). `window.open('about:blank')` gives `null`, and the page's code already goes itself then.
- **The Xcode project is made by `tauri ios init` where it is built,** in CI and on a Mac, and is not kept in git, as `src-tauri/gen/` is not today. It is kept once it holds something of our own (the Notification Service Extension, #966).
- **CI builds it for the simulator on every change to `desktop/`,** with no signing and no secret, starts it in a simulator and keeps a screenshot. A signed build for TestFlight needs the Apple Developer account (#967).

## Alternatives

- **A native SwiftUI app.** A third drawing of every screen, the reason the Mac app was stopped twice (ADR 008, ADR 031, ADR 142).
- **Only the web app on the Home Screen.** It stays, and works without an Apple account; but it can't be in the App Store, its notifications can't be answered, and nothing can be shared into it.
- **A separate Tauri project for iOS.** Two copies of the hand-off, the address screen and the link rules, which would drift.
- **Capacitor or another web shell.** A new technology beside Tauri, for what Tauri already does.

## Consequences

- `desktop/` holds the app for Windows, the Mac and the iPhone; its name stays, as the desktop's files and workflows carry it.
- Sign-in, push and the App Store follow in their own tickets (#965, #964 and #966, #967, #968). Until #965 the sign-in goes out to Safari and back on `botdot://`, as on the desktop.
- On iOS the web page opens its own pages over itself, in a sheet (#963), so a link that leaves the page is mostly another site's, which goes to Safari. What still goes in the window in place of the page has no back gesture.
- Every change to `desktop/` is also built for the iOS simulator in CI (`.github/workflows/ios.yml`).
