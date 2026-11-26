# ADR-281: An HTML file the owner opens is shown rendered on the sandbox's address, from a copy of its bytes

- **Status:** Accepted (the owner chose "render with scripts", 2026-11-26)
- **Owning task:** a bot's `site-mockup/index.html`, named in a chat reply and opened in the document viewer, showed numbered source lines and not the page
- **Builds on:** [ADR 072](072-an-interactive-page-is-a-bots-static-site-sandboxed-on-an-address-of-its-own.md) (the sandbox's address and its rules), [ADR 065](065-a-page-is-a-bots-markdown-kept-up-to-date-by-the-owners-tap.md) (never HTML from a bot on botdot's address), [ADR 004](004-pieces-as-restricted-shape-lists.md) (nothing a bot writes is trusted as markup)
- **Amends:** ADR 072, which let a bot's site run on the sandbox's address only as a page the bot published (`publish_interactive_page`): a single HTML file the owner opens may now be shown there too

## Context

The document viewer ([#251](https://github.com/ladrok/bot-dot/issues/251)) shows an `.html` or `.htm` file as numbered source lines, like any code. A bot with a computer often writes a small site, such as a one-page mockup, names its file in a reply, and the owner taps it. What the owner wants is the page, with its scripts, as a browser shows it.

The file is a bot's, so it is not trusted. Run on botdot's own address, its script would act as the owner: it could call the API with the owner's cookie, read chats and the vault's names, or send them anywhere (the reason for ADR 065). ADR 072 already built the one place where a bot's HTML may run: the front door's second address (`FRONT_DOOR_SITES_ORIGIN`, port 8443), which serves short-lived, signed `/<account>/<token>/<path>` addresses, with `Content-Security-Policy: sandbox allow-scripts` on every answer, framed by the apps with `sandbox="allow-scripts"` and nothing more.

That address serves only a published page, whose versions botdot keeps in a data folder no bot writes to. A file the owner opens is somewhere else: a bot's workspace on this server, the bot's folder on the account's computer, or a project's folder on it. The viewer has already read its bytes (at most 1 MB) to draw the source.

## Decision

- **The viewer's answer says it can be rendered.** For an `.html` or `.htm` file read whole (at most 1 MB, the viewer's own limit) the view answer (`?view=1`) gains `preview: { frame, expires }` next to the text it always had: `frame` the address of the file on the sandbox, signed for 12 hours (`TOKEN_MS`) and made anew each time the file is opened. Only where the front door names the sandbox's address and the account; otherwise the answer is what it was, and the apps show the source. `kind` stays `text`, so an app that does not know `preview` draws the source as before. `features` has `html-preview`.
- **The sandbox serves a copy, never the file's own place.** botdot puts the bytes it just read into a preview store, `previews/` in its data folder, which no bot writes to, as `<sha256 of the bytes>.html`. The token names that hash, not a path, so the sandbox never reads a bot's workspace, the computer or a project folder. Putting the same bytes again keeps one copy. A copy lasts as long as an address does (12 hours from the last time it was put), at most a hundred are kept (the oldest go first), the sweep runs on each put and at start, and a backup leaves the folder out.
- **One token, one file.** A preview's token is signed like a page's (the same key, in memory, so a restart ends every address), and its body is another shape (`k: "p"`, a hash, an expiry, no bot): a preview's token opens no page and a page's opens no preview. Its address answers for `index.html` and for the folder itself, and for no other path: a request for `app.js` or `style.css` is `404`. A wrong or run-out token is refused (`403`) before any file is looked for, and a copy that is a link is not served.
- **Exactly ADR 072's rules.** The front door's listener is unchanged: it takes the token and the path, passes on no cookie or header, and writes every header itself, so every answer carries `sandbox allow-scripts` and the rest of that CSP, with `script-src`, `style-src`, `img-src`, `font-src` and `connect-src` limited to the token's own prefix and `frame-ancestors` the app.
- **The apps.** The web page shows the file in a frame with `sandbox="allow-scripts"` only, as an interactive page is framed, and a Rendered / Source toggle like Markdown's, Rendered first. Source is the line view; Copy and Download stay. Android shows it in the same locked-down WebView an interactive page uses (JavaScript, no bridge, no storage, no file access, a link out asked about first). The web page frames only an address of the sandbox's shape (`https://host[:port]/<account>/<token>/index.html`), never a `javascript:`, `data:` or relative one. A machine without the sandbox's address, a server without `html-preview` and a file over 1 MB show the source, as before.
- **Scope is the one file.** What the file loads by a relative path (`style.css`, `app.js`, pictures) is not served, and its CSP lets it load nothing from elsewhere: inline styles, scripts and `data:` pictures work. The viewer says so beside the toggle ("Only what is in this file loads"). Serving a file's neighbours is follow-up work ([#1762](https://github.com/ladrok/bot-dot/issues/1762)).
- Nothing about a bot's published pages changes, and botdot's own address still never serves a bot's HTML: the raw download stays an attachment in `sandbox; default-src 'none'`, with a type that is not `text/html`.

## Alternatives

- **`srcdoc` on botdot's own address, in a frame with `sandbox="allow-scripts"`**: no second address and no copy, but the sandbox attribute is all that stands between the bot's script and the owner's cookie. One app that forgets the attribute, an old app, or a link opened alone runs the bot's script as the owner. ADR 072 turned this down for pages for the same reason; a separate origin fails closed.
- **A `Content-Security-Policy: sandbox` header with no scripts, on botdot's own address**: safe on its own and with no copy to keep, but the page runs no script. The owner turned it down: they want the page with its scripts. It would also put a bot's HTML on botdot's address as `text/html`, which nothing else does.
- **Letting the sandbox read the file where it is** (a token naming a bot and a path): it would put a path into a token and give the sandbox a reader of the bot's workspace and of the computer, a bigger door than ADR 072's, which reads only botdot's own folder. The copy costs 1 MB of disk for hours, at most a hundred times.
- **A key made of the file's place, not its hash**: a changed file would change under an open address. By hash, an address keeps showing what its opening read.
- **Publishing it as an interactive page**: the bot would have to publish it, the owner would see a new page in Pages for every file named in a reply, and a file the owner or a teammate wrote is not a bot's to publish.

## Consequences

- A bot's HTML, run with scripts, is on the sandbox's address after the owner's tap, never before: reading a view of the file is what makes the copy, and only the owner's routes do (the Chief gets no address, as it has no `x-botdot-account`).
- The same risks as ADR 072 stand: the CSP does not cover WebRTC, and the page can see the owner's device through what a browser tells every site. It cannot reach the account.
- A file that loads a font, a script or a picture from the internet, or a stylesheet beside it, shows without them. A mockup that depends on them looks plain until the follow-up lands.
- Disk: at most a hundred copies of at most 1 MB, each gone after 12 hours without being opened.
- Older apps and machines without the second address are unaffected: they draw the source.
- The iOS app has the viewer's source view only until it catches up ([#1355](https://github.com/ladrok/bot-dot/issues/1355)); the desktop app shows the web page and gets this as it is.
