# ADR-072: An interactive page is a bot's static site, sandboxed on an address of its own

- **Status:** Accepted (by the owner, 2026-10-22)
- **Owning task:** [#399](https://github.com/Kordal/bot-dot/issues/399)
- **Builds on:** [ADR 065](065-a-page-is-a-bots-markdown-kept-up-to-date-by-the-owners-tap.md) (a page is Markdown, never HTML), [ADR 071](071-a-page-draws-the-block-kit-bound-to-the-boards-tiles.md) (blocks bound to the Board's tiles), [ADR 035](035-the-account-has-one-computer-all-its-bots-work-on-with-sudo.md) (the account's computer)
- **Amends:** ADR 065's "Never HTML or scripts from the bot", for this one kind of page

## Context

A page with blocks (ADR 071) covers reports and overviews, but not what needs interaction: views to switch between, filters, a kanban, cards that open, a chart of the bot's own. Bots that use the computer can already build such a site (plain HTML, or Vite with Svelte or React). ADR 065 refused HTML from a bot because on botdot's address it is cross-site scripting into the owner's account: the page's script would run with the owner's cookie and could call the API, read chats and the vault's names, or send them anywhere. Showing a bot's site safely needs it kept away from the app, not trusted.

## Decision

- **A second kind of page, `interactive`.** The bot builds a static site in a folder of its computer and calls `publish_interactive_page`. The computer hands the folder over as a tar made by the box user (links and special files refuse it); botdot checks it (index.html at its top, at most 5 MB and 300 files, a list of allowed file types, plain names) and keeps it in its own data folder (`sites/<bot>/<slug>/<n>/`), which no bot writes. Each publish is a new version; the last ten are kept, and the owner rolls back to any of them.
- **An address of its own.** The front door serves the sites on a second origin: the same host on port 8443 (`FRONT_DOOR_SITES_ORIGIN`, a listener of its own). A page's address is `/<account>/<token>/<path>`, the token an HMAC (a key made in memory at start) naming the bot, the page and the version, good for 12 hours (an open page loads some of its files later) and signed for the owner when the viewer opens the page. The front door passes on only the account, the token and the path: no cookie, no other header, no query; it drops any cookie or framing header the answer has and writes every header itself.
- **Sandboxed twice.** The apps frame it with `sandbox="allow-scripts"` only, and every answer carries `Content-Security-Policy: sandbox allow-scripts`, so the page has an opaque origin even when opened alone: no cookies, no storage, no same-origin access to the app, no forms, popups or top navigation. Its CSP lets it load and fetch only its own token's files (`default-src 'none'`; scripts, styles, pictures, fonts and `connect-src` limited to that prefix, `data:` pictures and fonts), and `frame-ancestors` is the app. `'unsafe-inline'` is allowed for scripts and styles: built sites inline them, and inside this sandbox they reach nothing more than the page's files do.
- **Data comes in, one thing goes out.** The page reads its own `data.json`. Live values of the Board's tiles it names are pushed by the app over `postMessage` (`{ botdot: "values", values }`), read with the tiles' own rules and never as the owner. Its one request is `{ botdot: "open", url }`: the app shows where the link leads and opens it only on the owner's tap, outside the app.
- **Android** shows it in a WebView with JavaScript on and no bridge, no storage, no file access; a script the app injects turns the page's `open` into a navigation the WebView never loads, and hands it the values the same way. Anything off the page's own token prefix is asked about or blocked.
- **Install and update set up the second address**: Caddy gets the `:8443` site on a public domain, Tailscale Serve `--https=8443` on a tailnet, and the uninstaller turns it off.
- The viewer shows a page like this with a bar that says it is isolated, Full screen, Versions and Download (a zip of the version shown).

## Alternatives

- **A second host name** (`sites.<domain>`): a cleaner origin split (no cookies shared by host), but a second DNS name and certificate to ask the owner for, and on a tailnet a host name botdot can't make. Port 8443 is the same name and certificate; cookies are shared across ports, so the front door dropping the Cookie header and the opaque sandbox origin carry that.
- **The frame's `srcdoc` on botdot's own address with `sandbox`**: no second address, but one missed sandbox attribute (an old app, a link opened alone) runs the bot's script as the owner. A separate origin fails closed.
- **Blocks only (ADR 071)**: safest, but no interaction; the issue asks for it.
- **Letting the page call an API of its own**: more live pages, but a door back into the account. Values pushed by the app cover the Board's tiles, and a new version covers the rest.

## Consequences

- The sandbox's address is `https://<host>:8443`; port 8443 must be reachable where the app is. A machine without `FRONT_DOOR_SITES_ORIGIN` (an install not updated yet) shows the page's bar and download but no frame.
- The CSP does not cover WebRTC; in Chrome's sandboxed frame without `allow-same-origin` a peer connection to the internet is still possible in principle. The page holds only what the bot put in it and the values the app hands it.
- A frame's address is good for 12 hours after the viewer opened it; reopening, or Full screen after that, signs a new one. A bot keeps at most 20 interactive pages. A restart of the account's server makes earlier addresses fail.
- Versions cost disk: at most ten of 5 MB per page.
