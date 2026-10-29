# ADR-113: Shopping results are product cards, drawn from a fence in the reply

- **Status:** Accepted (by the owner, 2026-10-29, with direction B "Pick and list" of the mockups)
- **Owning task:** [#682](https://github.com/Kordal/bot-dot/issues/682)
- **Builds on:** [ADR 041](041-the-web-page-draws-mermaid-diagrams-with-a-vendored-mermaid-in-a-frame-of-its-own.md) (a fence in a reply drawn by the apps), [ADR 071](071-a-page-draws-the-block-kit-bound-to-the-boards-tiles.md) (blocks are fences), [ADR 086](086-botdot-fetches-site-icons-itself.md) (botdot fetches from the web, never the app), [ADR 004](004-pieces-as-restricted-shape-lists.md) (nothing from Claude is markup)

## Context

A bot that shops for the owner answers with a list of links and prices, which is hard to compare. The owner chose cards: the bot's pick as one large card with its photo, price, rating, store, why and delivery, Open and Save, and the other results as compact rows under it, one line of the bot's reply above them. The cards need the products as data, a photo from each store, and somewhere Save puts a product.

## Decision

- **A ```` ```products ```` fence in the reply.** It holds a JSON list; the first product is the pick. The reply stays Markdown the bot writes as before, and an app or a copy that doesn't know the fence shows it as code. The fence is read by the apps, as the rest of a reply's Markdown already is, by rules both share in `test/fixtures/products-cases.json`: known fields only, cut to their lengths, `https` addresses only, at most 10 products, the −% worked out from `price` and `was`. A fence that can't be read stays code. Every word is drawn as text.
- **botdot fetches the photos.** `GET /api/product-image?url=` (`lib/product-image.js`) uses the site icons' fetch (`lib/favicon.js`): HTTPS only, each hop's addresses checked against local, private and Tailscale ranges and pinned, at most 3 MB, a JPEG, PNG, WebP or GIF told by its bytes (never an SVG), kept on disk a week (a photo the store doesn't have, a day; a store that didn't answer or failed is asked again by the next card), and what is past its time leaves the folder. The apps never ask the store, so it learns nothing of the owner, and the page's policy stays as it is.
- **Save is a line in a file of the bot's.** `uploads/…-Saved-products.md` among the bot's files: the owner finds it in Files, can keep it in mind or delete it, and the bot is told of it with its other files, so "what did I save?" is answered by reading it. Saved again, a product is taken out. Only in a bot's reply: the Chief's has no Save.
- **The skill `kit:shopping`** says when and how to write the fence. Every bot is told its one-line description; the rules come only when it loads it, so the bot's prompt, at its cap, grows by one line. A kit skill switched off for a bot is now left out of the copy of the kit its run loads (`kitPack`), not only denied.
- Web first; Android draws the same fence from the same fixture in its own ticket. An app without it shows the code.

## Alternatives

- **A tool that returns the products (`show_products`).** A structured result, but a second channel next to the reply: the cards would not sit inside the text the bot writes, and a copy or an export of the reply would lose them.
- **botdot reads the fence and hands out `parts`, as pages do (ADR 071).** Pages have one view the server fills in; a reply is drawn from its text in many places (the chat, a draft as it is written, groups, rooms, the document viewer). A third reader of the same fence on the server buys no safety the apps' text-only drawing does not already have.
- **The app loads the store's photo.** Rejected as for site icons: the store would see the owner's address and when they read, and the page's policy would allow every image host.
- **Save into memory or the Board.** Memory has no screen to find it in; a tile per product clutters the Board. A file is visible, removable and read by the bot.

## Consequences

- botdot asks a store's image host once per photo a week, when a reply with it is drawn.
- A photo address the bot made up shows the placeholder; prices and dates are as true as the bot's reading of the store's page.
- A bot with a kit skill switched off gets a copy of the kit's other skills for each run, removed with the run.
