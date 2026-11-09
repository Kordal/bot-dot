# ADR-137: The desktop app is a Tauri window onto the front door, on Windows and Mac

- **Status:** Accepted
- **Owning task:** [#881](https://github.com/Kordal/bot-dot/issues/881)
- **Amends:** [ADR 0001](0001-native-apps-per-platform.md), [ADR 031](031-the-mac-app-is-stopped-again.md)
- **Amended by:** [ADR 170](170-the-desktop-app-on-linux-runs-botdot-on-the-computer-itself.md) (the same app for Linux: an AppImage, a .deb and an .rpm)

## Context

ADR 0001 chose native apps per platform, and accepted that every web feature is built again in Swift. The Mac app then fell behind and was stopped twice (ADR 008, ADR 031). Windows has no app at all. People who run botdot on a VPS or want it on their own computer ask for a desktop app, and a third drawing of every screen is what stopped the Mac app.

## Decision

- **One Tauri 2 project in `desktop/`** builds the desktop app for Windows (WebView2) and macOS (WKWebView). It is a new technology: Rust, with Tauri's crates in `desktop/src-tauri/Cargo.lock`. The server and the web page stay free of dependencies.
- **The window shows the front door's own web page.** The app draws one screen of its own, which asks for a botdot address. A feature is still decided once on the server and drawn twice: the desktop app is not a third drawing, so it cannot fall behind. This is an exception to ADR 0001 for the desktop. Android stays native.
- **The Mac comes back as this window.** This partly supersedes ADR 031. `macos/` stays as it is until the Tauri Mac app works, and removing it is a later ticket.
- **Sign-in is the front door's browser hand-off, with `app: "desktop"`.** The app opens `/sign-in?app=desktop&handoff=…` in the system browser, so the browser and its password manager answer the passkey, and takes `botdot://signed-in?code=…` back. A passkey never runs inside the window, which has no site identity of its own to offer on these unsigned builds.
- **The session cookie stays with the app, for one address,** in a file only its user can read, and goes into the window before the page loads. Arriving at `/sign-in` is how the app learns the session is over: the page goes there on a `401` with `signIn` and after a sign-out. The app then forgets the cookie and shows its own screen, with the address kept.
- **The window's page has no way into the app.** Only the app's own screen may call its commands. The window is full of text and frames from bots and other sites, so a page there can't start a sign-in or read the session.
- **Links to other sites open in the system browser.** A new window for the front door's own address (a PDF, "Open as document", a full-size screen) stays in the app and shares the session, and closes with it. Frames from other sites stay in their frames.
- **Only `https`, or `http` on the computer itself.** A passkey needs a secure page anyway, and the session's cookie must not cross a network in the clear.
- **Builds are unsigned at first.** Windows code signing and macOS notarization are follow-ups.

## Alternatives

- **Electron.** It carries a browser per app, about 200 MB, and gains nothing here: the page already runs in the system's WebView on both systems.
- **Draw the screens natively on each system.** That is what stopped the Mac app twice.
- **Keep only the browser, as a Mac and Windows reach botdot today.** It leaves no place for a botdot on the computer itself (#878) or for notifications that don't depend on the browser.
- **Passkeys inside the window.** The Mac app's own ADR history shows they need a signed app with an associated domain, which `localhost` can't be. The hand-off already works for Android and needs nothing new on the server beyond a name.
- **Let WebView keep the cookie alone.** The app would have nothing to give the notifications that later follow the live feed (#885), and no way to say whether it is signed in before the page loads.

## Consequences

- `app: "desktop"` joins `web`, `android` and `mac` in the front door, and the feedback a person sends from the window says it came from the desktop app.
- A new browser engine is in scope: what the web page does is now also checked in WKWebView and WebView2. Web Push doesn't work there, so the app follows the live feed itself ([ADR 138](138-the-desktop-app-rings-what-the-server-says-on-the-live-feed.md)).
- WKWebView has no dialogs of its own: `confirm()` answers false without asking unless the app shows it. The app's window answers `alert()` and `confirm()` with native dialogs on the Mac. WebView2 draws its own.
- `botdot://` reaches the app only from a built, installed bundle, so the sign-in cannot be tried with `cargo run`. On Windows a second start hands the link to the first.
- Bringing Windows and Mac builds to people is a later ticket (#883), as are several addresses and the tray (#884), and botdot on the computer itself (#886, #887).
