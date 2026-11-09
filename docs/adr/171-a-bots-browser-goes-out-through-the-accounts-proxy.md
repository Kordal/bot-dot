# ADR-171: A bot's browser goes out through the account's proxy

- **Status:** Accepted (2026-11-09, the owner approved the flow drawn on the real page)
- **Owning task:** the owner's request to let bots use a proxy
- **Builds on:** [ADR 035](035-the-account-has-one-computer-all-its-bots-work-on-with-sudo.md) (one computer, a screen and a browser bridge per bot), [ADR 098](098-the-accounts-computer-is-in-one-place-for-all-its-bots.md) (the account's computer is in one place)

## Context

A bot's Camoufox browser goes out from the machine's own address: a data-centre address that many sites block, slow down or answer with a captcha, and the same for every bot of every account on the machine. The owner wants bots to browse through a proxy they rent (a residential or mobile SOCKS5 or HTTP proxy with a login), for the whole account or for one bot. A proxy is only worth it when nothing leaks past it: a DNS lookup, a WebRTC address or a time zone that says where the machine really is gives the bot away as surely as no proxy at all.

## Decision

- **The account keeps its proxies; a bot picks one.** `data/proxies.json` (mode 600) holds each proxy, `socks5` or `http`, with its login; the password is encrypted with the Vault's key and leaves the server only for a bot's browser bridge and botdot's own test, never to the apps, the Chief or a bot (they see `hasPassword`). The account has one proxy every bot uses (`settings.proxy`, none at first); a bot may choose none or another one (`bot.proxy`: `""` for the account's, `none`, or an id). The Chief may list, test and pick the account's proxy, never add one or see a login: a proxy is a credential, and the owner types it in Settings → Proxy.
- **The browser goes through a forwarder in the bridge.** The bridge of each screen (`deploy/desktop/camoufox-browser`) gets the proxy over the helper on stdin (`{"op":"proxy"}`), never on a command line, keeps it in `/home/browser/proxy-<n>.json` (mode 600) for its next start, and runs a forwarder on `127.0.0.1:47300+n` that speaks SOCKS5 without a login to Firefox and signs in to the real proxy itself. Firefox's own SOCKS5 login is unreliable and its HTTP proxy login asks in a dialog, so neither is used.
- **Nothing goes out directly.** Names are resolved by the proxy (SOCKS5 with the name, `socks_remote_dns`), DNS over HTTPS is off (`network.trr.mode` 5), WebRTC uses only the proxy (`media.peerconnection.ice.proxy_only` and its siblings), and the browser's time zone and place come from the proxy's exit address (asked through it), its language staying the owner's. When the proxy doesn't answer, the browser stays closed and `open_browser` says so at once, with where the owner tests it: a bot never browses directly because its proxy failed. A changed proxy closes the open browser, so the next page uses the new one.
- **Commands follow when they can.** The same forwarder also speaks HTTP (CONNECT and plain `http://`), and a bot's shell commands get `HTTP_PROXY`, `HTTPS_PROXY` and `ALL_PROXY` to it. This is best effort: a tool that ignores them goes out directly. botdot's own traffic (Claude, connectors, the feed) never goes through a proxy.
- **On the External Virtual PC** (boat.dev), which has one browser for the account, the account's proxy is used, browser only; a bot's own choice applies on the account's computer.
- **A test says where it comes out.** Test makes one HTTPS request from botdot's server through the proxy, the same SOCKS5 and HTTP CONNECT handshake as the bridge, to a service that names the exit address, its country and city (`lib/proxy-check.js`), and keeps the answer beside the proxy so every app shows it as a green or red dot with "🇵🇱 Warsaw".
- **Drawn twice.** Settings → Proxy (the one the bots use, the list with Test, a dialog to add or change one, where a pasted address fills the fields) and a bot's Proxy row, on the web page and in the Android app; `features` has `proxies`.

## Alternatives

- **A proxy in the Vault, as a secret:** the Vault holds what bots use by name and may be read by a bot's tools; a proxy's login must never reach a bot, and it needs a test and a place to be picked, which a secret has not.
- **Firefox signs in to the proxy itself:** SOCKS5 with a login is not supported by Firefox, and an HTTP proxy's login comes as a dialog a bot would have to answer.
- **A proxy for the whole computer (iptables, a transparent proxy):** every bot on the computer would share it, and botdot's own traffic from the computer would go through it; a choice per bot needs a forwarder per screen.
- **Go out directly when the proxy fails:** the bot's real address would leak to sites it was hiding from, with nothing to show it happened.

## Consequences

- Each screen's bridge may run a forwarder; an old bridge without the `proxy` op is started again from the synced launcher when a proxy is set.
- A bot whose proxy is down can't browse until the owner fixes or changes it; it says so in its run.
- Commands through the proxy are not guaranteed: tools that ignore the proxy variables go out directly.
- The test asks a third-party service (`ipinfo.io`) for the exit address from botdot's server, through the proxy only.
