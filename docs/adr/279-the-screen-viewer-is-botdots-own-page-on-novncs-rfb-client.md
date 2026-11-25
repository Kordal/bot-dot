# ADR-279: The screen viewer is botdot's own page on noVNC's RFB client

- **Status:** Accepted (spec in [#1732](https://github.com/ladrok/bot-dot/issues/1732))
- **Owning task:** [#1733](https://github.com/ladrok/bot-dot/issues/1733)
- **Amends:** [ADR 035](035-the-account-has-one-computer-all-its-bots-work-on-with-sudo.md) and [#105](../decisions/2026-10-19-each-bots-screen-on-the-accounts-computer-105.md) (what the screen address serves), [ADR 149](149-outside-chromium-a-boat-dev-machines-desktop-is-botdots-own-viewer.md) (the viewer is no longer noVNC's page)

## Context

Every place that shows a bot's computer showed noVNC's demo page in a frame: the computer dialog, a run's live screen, the picture-in-picture, the full-screen link, the Android WebView and, on boat.dev machines in Safari and Firefox, the same page. It is made for VNC experts: a settings bar with scaling, quality and compression, a clipboard panel, and "Failed to connect" while the computer starts. botdot hid the last by reading the frame's text every four seconds and reloading it (`keepScreenConnected`), which also reloaded a screen that had only blinked.

## Decision

- **The page is botdot's own** (`screen/viewer.html`, `screen/viewer/`), drawn on noVNC's RFB client (`vendor/novnc/core`, unchanged, with the pako it loads). noVNC's demo page (`vnc.html`) and its `app/` folder are deleted from `vendor/` and never served.
- **It is served at the address the screen has always had:** `/computer/<botId>/vnc.html` (and `/`), over the same WebSocket `/computer/<botId>/websockify`. The page reads `view_only` from its query and ignores the rest, so the web page, the PiP, the run's live screen, the boat.dev path and the Android WebView (`ComputerScreen.url`, which still sends noVNC's old query) need no new address. `view_only=0` still counts as taking control ([ADR 107](107-an-irreversible-step-on-a-bots-computer-waits-for-a-card.md)); a computer that is off still answers `503` with its note.
- **The server serves four things under that address:** the page, its own scripts and stylesheet (`viewer/`), the RFB client (`core/`) and pako (`vendor/`). Nothing else of noVNC's folder. The page has a policy of its own: its own scripts and styles, its own WebSocket and nothing from anywhere else.
- **No settings.** The picture is scaled to the remote desktop's own size (the whole desktop, whatever its aspect ratio, so a different screen size needs no change here), at noVNC's default quality and compression.
- **The page speaks in botdot's states:** Starting the computer…, Watching, You have control, Reconnecting…, Turned off. It connects by itself, tries again every 2 seconds when it can't connect or has dropped, and asks the page's own address with `HEAD` when it drops: `503` is Turned off. A turned-off note the server sends (the page itself, when the computer is off at load) asks again every 5 seconds.
- **It tells the frame's parent its state** with `postMessage({ type: 'botdot-screen', state })` to its own origin. The web page believes only a message from the frame's own window, from its own origin, and shows it as `data-screen` on the iframe. `keepScreenConnected` is deleted: nothing reads the viewer's text and nothing reloads the frame.
- **The picture comes through a transport** (`screen/viewer/transport-rfb.js`): `createTransport({ target, url, viewOnly })` with `connect` and `disconnect` events, `setViewOnly`, `focus` and `disconnect`. The page knows nothing of RFB. Clipboard, keys and touch grow this surface in their tickets ([#1734](https://github.com/ladrok/bot-dot/issues/1734) to [#1736](https://github.com/ladrok/bot-dot/issues/1736)); a video transport (the Selkies trial) can implement the same surface.

## Alternatives

- **Keep noVNC's page and style it.** Rejected: its settings, its clipboard panel and its dialogs are the problem, and its page is built to be configured, not to report a state to its parent.
- **A new address for the viewer.** Rejected: the Android app and the iOS app would need a change, and an older app would keep working only by an address kept for it.
- **Reload the frame from the web page, as before.** Rejected: it reloads a screen that only blinked, and it reads another page's text.

## Consequences

- One viewer for the web page, the desktop app, the Android WebView and boat.dev's VNC path, and the place the clipboard, touch and file drop of the same spec grow.
- `vendor/novnc` is now `core/` and its pako; a newer noVNC (1.7.0 is out, see [external-tools](../external-tools.md)) replaces those two folders, and the viewer's one import of `RFB` is the only place that has to follow.
- A `HEAD` on the viewer's address is the question "is the computer on?" and has no side effect, so it never counts as taking control.
- The browser check `test/browser/screen-viewer.cjs` runs the viewer against a stand-in VNC server (it is not part of `make test`).
