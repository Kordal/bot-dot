# ADR-149: Outside Chromium, a boat.dev machine's desktop is botdot's own viewer

- **Status:** Accepted (2026-11-04)
- **Amends:** [ADR 093](093-the-owner-watches-a-boat-dev-machines-desktop-through-boat-devs-stream.md)

## Context

boat.dev's default desktop stream (Moonlight over WebRTC) never draws a frame in WebKit: in Safari and in the Mac app (Tauri, WKWebView) it stays on "Connecting to desktop stream...", though WebRTC connects and video arrives and is decoded (seen 2026-11-04 on macOS 27, Safari 27; the same address works in Brave). The fault is in boat.dev's viewer, which botdot cannot change. Its noVNC mode (`?vnc=1`) does not work in a frame (its sign-in cookie needs a top-level page). The account's computer already shows each bot's screen in botdot's own noVNC, over a WebSocket botdot passes on to websockify (`/computer/<bot>/websockify`), and that works in every browser.

## Decision

- **Outside Chromium the app asks for botdot's viewer** (`POST /api/bots/:id/computer/desktop` with `{ via: "vnc" }`, feature `boat-desktop-vnc`): the web page uses it where `navigator.userAgentData` is missing (Safari, the Mac app, Firefox). Chromium browsers, the Windows app and Android keep boat.dev's stream at 60 fps.
- **On the machine, the screen kit adds x11vnc on `:0` and websockify**, both on the machine's loopback (ports 5911 and 47110), started with the screen on the first such ask after the machine started.
- **boat.dev carries websockify's port** (`POST /sandboxes/{id}/host`, `localhost: true`, never `public`) to an address gated by a token. botdot alone holds the token, in memory, and opens that address itself with the token as the `_port_auth` cookie boat.dev asks an API client for, passing on only the WebSocket's own headers.
- **The page is the account's computer's viewer** (`/computer/<bot>/vnc.html`): watching until Take control (`view_only`), Take control counted as on the account's computer (ADR 107), and its full-screen link is botdot's own address. No address of boat.dev reaches the app.

## Alternatives

- **boat.dev's noVNC (`?vnc=1`) in a window of its own.** Rejected: a separate window, its token in the address, and no watching mode of botdot's.
- **Third-party cookies allowed in the Mac app** (WKWebView's private API), so boat.dev's noVNC works in a frame. Rejected: private API, and Safari stays broken.
- **botdot's viewer everywhere.** Rejected for now: boat.dev's stream is smoother where it works.

## Consequences

- The screen passes through the botdot server on that path: its bandwidth is the server's.
- Anyone on the machine can reach x11vnc on its loopback; the bots on it already drive that desktop.
- If boat.dev's viewer is fixed for WebKit, the page's check can go and every app use the stream again.
