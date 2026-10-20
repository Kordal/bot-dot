# ADR-041: The web page draws Mermaid diagrams with a vendored Mermaid, in a frame of its own

- **Status:** Accepted
- **Owning task:** [#177](https://github.com/Kordal/bot-dot/issues/177)

## Context

Bots and the Chief of Staff should be able to answer with a diagram. The owner chose Mermaid (#177): a reply, a Board tile or a skill with a ```` ```mermaid ```` block shows the diagram on the web page, with "Show code" under it; the Android app shows the code with "Open on web" (no native drawing yet); the Mac app is stopped ([ADR 031](031-the-mac-app-is-stopped-again.md)).

Rule 6 of `AGENTS.md` says nothing a bot or the Chief writes is trusted as markup: text and drawings from Claude are checked on the server and drawn by the apps' own code ([ADR 004](004-pieces-as-restricted-shape-lists.md)). Mermaid is the first library from elsewhere that turns a bot's text into a drawing, and ADR 004 rejected "raw SVG from the Chief, sanitised" because sanitising SVG is a known source of holes. A Mermaid source is not SVG, but Mermaid makes SVG from it, with the bot's words in it, and puts it in the page.

What the code showed (Mermaid 12.2.0 in Chromium, `test/browser/diagram.cjs`):

- At `securityLevel: 'strict'` Mermaid binds no click handler and its DOMPurify takes event handlers and `javascript:` links out of labels. It keeps the rest of the HTML a label holds: an `<img>` with any address, a `style` with `url(…)`.
- Mermaid draws in the live page to measure its text, before it hands back the SVG. A picture in a label is fetched then. The page's policy allows images from `https:` (the logos of connected apps), so a bot's diagram could make the browser call an address of the bot's choosing: a read receipt, the owner's address.
- A diagram can change Mermaid's settings itself (`%%{init: …}%%`, front matter), apart from a few keys Mermaid keeps.
- The page's policy is `script-src 'self'`: Mermaid can't come from a CDN.

## Decision

- **Mermaid is vendored, pinned and unchanged.** `vendor/mermaid` holds Mermaid 12.2.0's `mermaid.min.js` (one file, 5.5 MB, 1.6 MB with gzip), its `LICENSE` and its `package.json`, as `vendor/novnc` holds noVNC. `NOTICE` names it, and the libraries it bundles keep their licences in the file's last comment. botdot serves it from its own address, `/vendor/mermaid/`, with the page's files: in memory, with gzip and brotli, checked back with an ETag. A new version is a change of this folder, `NOTICE` and the server test that names the version.
- **The page loads it only for a diagram.** `mdBlocks` keeps the word after a fence (`lang`, in the shared `test/fixtures/markdown-cases.json` and in Android's `parseBlocks`), and `mdHTML` writes a `mermaid` block as its escaped code, `<pre class="mermaid-src">`. `public/diagrams.js` watches the page and its dialog; the first such block makes the frame, and a page without one never asks for Mermaid.
- **Mermaid draws in a frame of its own.** `/diagram-frame.html` is a hidden frame of the page, with a policy of its own (`FRAME_CSP` in `server.js`): its own scripts, Mermaid's inline styles, the page's font, images only from `data:`, nothing else from anywhere. What Mermaid puts in the live page while it measures is stopped there. The page sends it a source by `postMessage`; it answers with the SVG as text, or with the reason it could not draw it. Each side answers only the other, from the same address. In the frame Mermaid runs with `startOnLoad: false`, `securityLevel: 'strict'`, `suppressErrorRendering: true` and its `dark` theme on the page's black, in Geist.
- **The page cleans what comes back before it shows it.** The SVG is parsed into an inert `<template>`, where nothing loads, and `scrub` takes out pictures, media, frames, objects and scripts, turns a link into a group (or a span) that keeps its place and what it holds, and removes every `on…` attribute and every attribute that names an address but the drawing's own (`#…`, `url(#…)`): a `url(…)`, CSS's other ways to name a picture (`image-set()`, `image()`, `cross-fade()`, `element()`, `paint()`), `@import` and any CSS escape, which Mermaid's own markup never has. A style sheet with any of these goes whole, its colours with it. Then it takes the code block's place, at most as wide as the bubble, with "Show code" under it.
- **A block Mermaid can't draw stays its code,** with "Diagram could not be drawn" under it and the reason in the console, and nothing else in the message changes. A frame that does not load (no answer in 20 seconds, or no Mermaid in it) or does not answer a drawing in 20 seconds does the same, and the next block makes a new frame and tries again.
- **The same source is drawn once per page load.** A thread drawn again finds its SVG by its source.
- **Android shows the code with a link.** A `mermaid` block in a chat is its code block with "Open on web" under it, which opens the same chat on the web page (`<server>/#chief/<chatId>`, `#bot/<id>`, `#group/<id>`). A tile or a skill, which is in no chat, shows the code without a link. Native drawing is a later issue.
- **Bots are told.** `CHAT_FORMAT` says a diagram is a Mermaid block, to be used only when it explains better than text, and what each app does with it.

So rule 6 holds this way for diagrams: the bot's text is never put in the page as markup. It is drawn by a pinned library the page ships, in a frame that can reach nothing, and only a cleaned drawing of it reaches the page.

## Alternatives

- **Mermaid in the page itself, at `strict`** (as the issue proposed). Rejected: a picture or a `url(…)` in a label is fetched while Mermaid measures, from addresses the page's policy allows, before any cleaning can happen; and a diagram's own `%%{init}%%` can change settings.
- **A sandboxed frame as well** (`sandbox="allow-scripts"`, an origin of its own). Not tried: the frame's own policy already keeps it from reaching anywhere, and the page checks who sends each answer. It stays an option if the frame is ever given more to do.
- **Tighter `img-src` for the whole page.** Rejected: the page shows the logos of connected apps from their own addresses.
- **Drawing the diagram on the server.** Rejected: Mermaid needs a browser to measure text, so the server would need a headless browser, and botdot has no dependencies.
- **Mermaid's ESM build** (one small file and about a hundred chunks, loaded by kind of diagram). Rejected: a hundred files to vendor and serve for a smaller first download; the one file is 1.6 MB once, with gzip.
- **A diagram format of botdot's own, checked on the server,** as the hats are (ADR 004). The safest, but it is a new language for the bots to learn, and the owner asked for Mermaid.
- **A CDN.** Rejected: the page's policy is `script-src 'self'`, and the page must work without the internet beyond botdot.

## Consequences

- The page loads 1.6 MB more the first time a diagram is on it after a load, and the frame stays for that page load.
- A Mermaid update is a reviewed change: its file, its version in `NOTICE` and the test, and `test/browser/diagram.cjs` run against it.
- What a diagram can show is what Mermaid draws, without pictures and links in its labels. Mermaid's own icons from outside packs (`icon:` shapes), and anything else Mermaid would fetch, do not appear.
- `STATIC_MAX`, the largest file the server keeps in memory, is 8 MB (it was 4 MB), and a file over 1 MB gets brotli at quality 5, so the server makes Mermaid's copies once in a third of a second, not in ten seconds.
- On Android a diagram is code until the native drawing comes; the link needs the web page to be reachable from the phone's browser and signed in.
- A restarted Mac app reads `lang` from the shared cases and follows Android.
