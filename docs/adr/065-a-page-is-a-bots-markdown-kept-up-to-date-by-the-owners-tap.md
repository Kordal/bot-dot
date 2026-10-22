# ADR-065: A page is a bot's Markdown, kept up to date by the owner's tap

- **Status:** Accepted (by the owner, 2026-10-22)
- **Owning task:** [#346](https://github.com/Kordal/bot-dot/issues/346)
- **Builds on:** [ADR 004](004-pieces-as-restricted-shape-lists.md) (nothing from Claude is trusted as markup), [ADR 054](054-a-permission-card-comes-only-from-the-bots-ask.md) to [ADR 059](059-a-note-is-saved-without-an-ok.md) (fewer approvals)

## Context

The owner asks a bot for a report, a memo or an overview they will come back to. Today the bot writes a file that ends up lost in its workspace, or pastes the text into a reply that scrolls away. Other assistants let a bot build a page and keep it up to date. botdot already has the document viewer (#251), the workspace (#296) and jobs; what is missing is the page as a thing of its own, and one tap that keeps it fresh.

## Decision

- **A page is Markdown in the bot's workspace**: `pages/<slug>.md`, written by the bot's tool `save_page`. Its runs read and rewrite it like any of their files. What the page is (title, when it was made and last saved, what it is built from, the job that keeps it up to date) is kept in botdot's own data folder (`pages.json`), which no bot writes, so a bot can't fake when a page was updated or which job keeps it.
- **Never HTML or scripts from the bot.** The apps draw a page with their own Markdown code, as the viewer draws a file, and the route never serves it as a page on botdot's address. This is weaker than a free-form artifact, on purpose: HTML from Claude on the botdot address would be cross-site scripting into the owner's account.
- **A run lists the pages it saved** (`pages` on the run): a chip under its reply opens the page. A bot's pages are listed in its settings. A `page` event on the live feed redraws an open page and that list.
- **"Keep up to date" is the owner's tap, and that tap is the consent.** It makes an AI job of that bot, by the owner (`by: "you"`), which is approved at once as any job the owner makes on the jobs screen: no card. The schedule is picked from three words (every hour, every morning, every Monday, with a time) that the server turns into a cron, so both apps draw one sheet. A different schedule is the owner's to ask the bot or the Chief for.
- **The job is quiet by default**: report-only, so the owner hears only when the bot calls `notify_owner`; "every time" makes it `notify: "always"`. The page shows when it was last updated either way.
- **Only the owner** opens pages and keeps them up to date. The Chief neither reads nor changes a page through these routes.

## Alternatives

- **A page as HTML in a sandboxed frame** (like the diagram frame of ADR 041): richer pages, but a second rendering path for content Claude wrote, and an open door for anything the sandbox misses. Charts and diagrams in pages are their own later step, as blocks the apps draw.
- **A page as a Board tile**: tiles are glanced at, not read; a memo does not fit in one.
- **"Keep up to date" asked of the bot by chat only**: the bot would set up the job itself, which waits on a card (ADR 064 approves only one-time checks). One tap, with the schedule on the sheet, is the owner's own job and needs no second OK.

## Consequences

- A kept page costs one AI run per refresh on the owner's machine; the sheet offers no schedule more often than hourly, and the default is once a morning.
- A page whose file the owner deletes in the Workspace leaves the list; its keeping job stays on the jobs screen until removed there.
- Editing a page in the viewer, and charts in pages, are later tickets; until then the owner changes a page by asking the bot.
