# ADR-086: botdot fetches site icons itself

- **Status:** Accepted (2026-10-24)
- **Owning task:** [#530](https://github.com/Kordal/bot-dot/issues/530)

## Context

Bots answer with links, and a row of bare addresses is hard to scan. Other chat apps put the site's small icon (its favicon) before each link. An icon has to come from somewhere: a public favicon service (Google's, DuckDuckGo's) would see every link the owner's bots send; the apps fetching it from each site would show that site the owner's address and the moment they read the message. botdot already fetches from the internet for the owner (notifications, `api_request`) and refuses private addresses there (`lib/network-address.js`).

## Decision

- **The botdot server fetches the icon, and only it.** `GET /api/favicon?host=` (`lib/favicon.js`) answers the icon it keeps for a site; the apps load nothing from the site itself and no favicon service is used.
- **Where it looks:** over HTTPS only, the icons the site's home page names in `<link rel="icon">` (then a touch icon), then `/favicon.ico`; at most 4 tries and 3 redirects each, 8 seconds per request.
- **What it keeps:** a PNG or an ICO of at most 32 KB, told by its first bytes, whatever the site says it is. An SVG is never kept: it can hold scripts. The answer goes out with `Content-Security-Policy: sandbox` and `nosniff`.
- **SSRF:** the host must be a public DNS name; each hop's addresses are resolved, refused when any is local, private or Tailscale (100.64.0.0/10), and pinned for the request, as notifications do.
- **Cache:** on disk under `data/favicons/`, an icon for 7 days, a site without one for 1 day, so a site sees the server at most once a week. One fetch per site at a time, four sites at once. The browser and the phone keep the answer as long.
- **No icon:** a 404, and each app draws its own grey globe. Drawn on a light rounded backing, so a dark icon shows on the dark theme.
- **Where:** the links of replies in a chat (a bot's, the Chief's, a group's, a shared room's), not tiles or pages; announced as `site-icons` in `features`.

## Alternatives

- **A favicon service.** Rejected: a third party would see every linked site, and botdot is self-hosted so it doesn't depend on one.
- **The apps fetch from the site.** Rejected: the site would see the owner's address and when they read, and the web page's CSP would have to allow any image host.
- **Accept SVG and sanitise it.** Rejected: a sanitiser is a dependency or a risk for a 16 px picture; most sites also have a PNG or an ICO.
- **No icon, only the domain in grey.** Rejected: it adds a label, which the UI rule cuts.

## Consequences

- A site may show an icon that looks like another's; the link's address is unchanged and still what opens.
- The server makes outbound requests on the owner's behalf when a reply with a new site is drawn: one per new site, kept a week.
- A site whose only icon is an SVG, larger than 32 KB, or on another port shows the globe.
