# ADR-069: The Chief keeps pages too, kept up to date by a run of its own

- **Status:** Accepted (by the owner, 2026-10-22)
- **Owning task:** [#384](https://github.com/Kordal/bot-dot/issues/384)
- **Builds on:** [ADR 065](065-a-page-is-a-bots-markdown-kept-up-to-date-by-the-owners-tap.md) (a page is a bot's Markdown, kept up to date by the owner's tap), [ADR 006](006-a-look-is-its-own-read-only-chief-session.md) (a look: the Chief's own session with reading tools)

## Context

The owner wants the Chief of Staff to have what a bot has. A bot saves a page with `save_page` and the owner keeps it up to date with one tap (ADR 065); the Chief had neither. A bot's "Keep up to date" is a job of that bot, but the Chief has no jobs: its turns live in chats, and botdot starts it only for a late result, a reminder, a look and a checkup.

## Decision

- **The Chief saves a page with `save_page`**, as a bot does: its Markdown in `pages/<slug>.md` of the Chief's folder, what the page is in botdot's `pages.json` under the id `chief` (a bot's id is eight hex characters, so no bot has it). The reply being written lists it in `pages`, and the apps draw its chip there as under a bot's reply.
- **Saving a page is free after the web.** A page built from what the Chief read is what a page is for, and it changes nothing else in botdot, so it never waits on a card (server.js `FREE_AFTER_WEB`), as a bot's `save_page` never does.
- **The apps reach the Chief's pages at a bot's page routes with the id `chief`** (`/api/bots/chief/pages…`), and `GET /api/pages` lists them with the bots'. An app that opens a bot's page opens the Chief's with no code of its own; only the chip under its reply and its list in its settings are new, behind the feature `chief-pages`.
- **"Keep up to date" keeps the schedule with the page**, not as a job: the same sheet and words (every hour, every morning, every Monday), turned into a cron by the server. botdot checks every minute, and when a page is due it runs the Chief in a session of its own, as a look runs: no chat's session, nothing kept, the web, botdot's reading tools and `save_page`, and nothing else. It is handed the page and saves it anew. The owner's tap is the consent, as for a bot's page. "Refresh now" is that page's job id, `page-<slug>`, at the bots' `…/jobs/:jobId/run`.
- **What it tells the owner** is its last words, posted in the chat the owner last used with the page's chip: always when they chose "every time", else only when something on the page needs them (an answer of NOTHING posts nothing). The owner's next turn there is told it was the Chief's own message from a run that read the web, as a look's is.
- **One at a time.** A keeping run waits while a look, a checkup or another page's run is at work, and is tried again on the next minute.

## Alternatives

- **A scheduled turn in a chat of the Chief's**: all its tools, and its session would carry what the page's sources said into the owner's chat. A look's session reads and saves the page, and changes nothing else.
- **Jobs for the Chief in general**: a far larger change than its pages need; the page keeps its own schedule until the Chief has jobs.
- **Separate routes for the Chief's pages** (`/api/chief/pages/…`) for the apps: every app would need code to open them, and an older one could not open the Chief's rows in the Pages list.

## Consequences

- A kept Chief page costs one run of the Chief's model per refresh; as for a bot's page, nothing is offered more often than hourly.
- The Chief's own pages are the only pages it writes; it still neither reads nor changes a bot's page.
- Should the Chief get jobs later, a page's `keepOwn` moves to one of them.
