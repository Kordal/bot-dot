# ADR-093: The owner watches a boat.dev machine's desktop through boat.dev's stream

- **Status:** Accepted (2026-10-26)
- **Owning task:** [#564](https://github.com/Kordal/bot-dot/issues/564)
- **Amends:** [ADR 088](088-a-bots-computer-may-be-a-machine-of-its-own-on-boat-dev.md)

## Context

ADR 088 said a bot's machine on boat.dev has no screen. It has one: every machine runs an X11 desktop, and `POST /sandboxes/{id}/desktop` answers an address of a stream of it (the default stream, which works in a frame; noVNC with `?vnc=1`, which does not). Anyone who has the address may attach to the desktop; a new viewer may open it for 10 minutes, and a stream already open keeps playing. boat.dev names the stream's host anew for each machine and documents no view-only mode.

## Decision

- **botdot asks boat.dev for a new address each time the owner's app asks** (`POST /api/bots/:id/computer/desktop`, the owner only): never kept, never logged, handed only to that app. A machine that is not on starts in the background and the answer is `starting` until it runs, as it is while boat.dev readies the desktop.
- **The app asks again every 4 minutes while the screen is open.** Each ask counts as use, so a watched machine does not stop, and the app always holds an address under 10 minutes old (its full-screen link). The stream shown is not reloaded; after the machine stopped or started again it is shown from a new address only.
- **Watching or control is the app's.** As on the account's computer, the owner watches until Take control: a shield over the stream keeps clicks, taps and keys off it.
- **The web page frames it in a frame of its own** (`public/boat-desktop.html`), whose policy alone allows an `https:` frame. The page hands it the address in its fragment, which never reaches botdot. The page's own policy keeps `frame-src 'self'`. Android shows the stream in a WebView.

## Alternatives

- **`frame-src https:` on the page itself.** Rejected: every frame of the page could then come from anywhere.
- **The stream's host in the page's policy.** Not possible: boat.dev names it per machine and documents no pattern.
- **noVNC (`?vnc=1`) with `view_only`.** Rejected: it does not work in a frame (its sign-in cookie needs a top-level page).
- **The address kept and reused until it expires.** Rejected: it is a secret that lets anyone in; asking again is one call.

## Consequences

- An address shown in the owner's app lets anyone who copies it attach to the machine's desktop for 10 minutes; botdot does nothing more to guard it than to hand it only to the owner.
- Whether the stream takes the owner's mouse and keyboard is boat.dev's; the shield is the only view-only mode.
- The bot itself still has no screen or browser tools there; that is #563.
