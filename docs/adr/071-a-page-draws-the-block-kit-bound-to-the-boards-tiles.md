# ADR-071: A page draws the block kit, bound to the Board's tiles

- **Status:** Accepted (by the owner, 2026-10-22, with the plan of [#393](https://github.com/Kordal/bot-dot/issues/393))
- **Owning task:** [#395](https://github.com/Kordal/bot-dot/issues/395)
- **Builds on:** [ADR 065](065-a-page-is-a-bots-markdown-kept-up-to-date-by-the-owners-tap.md) (a page is a bot's Markdown), [ADR 004](004-pieces-as-restricted-shape-lists.md) (nothing from Claude is markup)

## Context

A page is Markdown, drawn by the apps' own code (ADR 065). The owner wants pages that look like the Board's status page (#394): a hero, kpis with their change and a sparkline, charts side by side, with numbers that stay live without an AI run. "Keep up to date" rewrites the whole page with a run; a number that changes every minute should not need one.

## Decision

- **Blocks are fences in the Markdown.** A fence named after a block of the kit (`hero`, `kpi`, `chart`, `status`, `callout`, `grid`) holds one JSON object, or a list (a row of that block). The page stays one Markdown file the bot reads and rewrites as before, and any Markdown reader shows the fence as code.
- **botdot checks and fills them in; the apps draw them** with the Board's kit (`public/blocks.js`, `BlockKit.kt`). The view of a page hands out `parts`, the Markdown between its blocks and each block filled in, so neither app parses the fences. Still never HTML from a bot: every word is drawn as text.
- **A live number is a tile.** A block with `tile` reads a tile of the Board as a block of that tile does (`lib/tile-blocks.js`), so a page's sources are the Board's sources: their logins, their scripts and the owner's OK on a script, their refresh, the live feed's `dashboard`. A bot adds a source for its page as it adds any tile (suggest_tile, or set_tile on its own). The tile keeps the recent values a page's kpi or chart shows, and a page that is read reads its tiles that are due.
- **A block that cannot be drawn is a quiet line,** never a broken page; `save_page` says which ones, so the bot fixes them.
- **Out of botdot, blocks are text and tables** with the values they show then: Copy, Open as document and its export, and the download.

## Alternatives

- **Sources of a page's own** (reads kept with the page): a second copy of what tiles already do, with its own approvals and refresh. A page's source on the Board is also one the owner sees and can tap.
- **The apps parse the fences:** three parsers (server for checks, web, Android) that must agree; `parts` keeps it in one place.
- **HTML pages from the bot:** refused here (ADR 065); an interactive page in a sandbox of its own is #399.

## Consequences

- A tile made only to feed a page shows on the Board too.
- A tile renamed after a page bound to it by title shows that block as one that cannot be drawn until the page is rewritten; binding by id avoids it.
- An older app shows the fences as code blocks; a newer app on an older server gets no `parts` and shows the Markdown as before.

## Amendment: a page on the Board (#451, 2026-10-23)

The other way round: a page can be a tile of the Board. A tile of kind `page` points to the page (`page: { bot, slug }`) and has no sources and no blocks of its own; botdot fills in its look from the page each time the Board is read: up to three of the page's first kpis, else its first chart, else its first lines, and nothing for an interactive page. The apps draw it with the block kit and open the page on a tap. The owner puts it there with "Board" on the page or the switch in the Pages list, the Chief with `add_tile`, a bot by suggesting its own page; no page is there by itself. A tile whose page is gone is not shown until the page is back, and goes with its bot.

