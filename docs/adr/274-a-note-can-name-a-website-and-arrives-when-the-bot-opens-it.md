# ADR-274: A note can name a website, and arrives when the bot opens it

- **Status:** Accepted
- **Owning task:** [#1713](https://github.com/ladrok/bot-dot/issues/1713)
- **Builds on:** [ADR 014](014-botdots-memory-is-the-only-memory-a-bot-keeps.md) (the memory is botdot's, and what it prints into a prompt is inert), [ADR 015](015-the-server-records-who-said-a-note.md) (who said a note), [ADR 016](016-a-forgotten-note-is-erased-and-a-removed-one-ends.md) (forget and remove)

## Context

A bot that works in the browser of its computer learns things about a website: where the login is, that a cookie banner must be closed first, which page holds the invoices. A note reaches a run by the lookup on the task's words, or by recall. A task such as "pay the electricity bill" does not name `energa.pl`, so when the bot opens that site in the middle of the run, the note about it may never have arrived.

## Decision

- **A note can name a website.** `remember` and `update_memory` (the bot's tools) and the Chief's `remember` and `update_note` take an optional `site`: a host such as `energa.pl`. botdot saves it normalised: lower case, with no scheme, no trailing slash and no `www.`. A value that is not a plain host (a path, a port, a wildcard, an address, a sentence) is refused with the reason, and nothing is saved. `""` in a change takes the site away; no `site` leaves it as it is. It is a column `site` of `notes`, `note_versions` and `pending` (`SCHEMA_VERSION` 6, through `COLUMNS`), so an earlier version keeps the site it had and a note that is brought back has it again. Nothing else about a note changes: its source, its pin, its end and its project are what they were.
- **Notes arrive with the page.** `open_browser` and `browser_goto` ask botdot, in the request they already make, to add the bot's notes about the page they landed on (`arrive: true` on `POST /api/vault/session/computer/browser`). botdot takes the page's host from the first line of the snapshot it has just read, and adds to the end of the answer the notes of the bot and the shared notes whose `site` is that host or a parent domain (`login.energa.pl` gets the notes of `login.energa.pl` and of `energa.pl`; `energa.pl` does not get those of `login.energa.pl`). The other browser tools never add notes.
- **How many, which, and how often.** At most five, pinned first, then the newest first. In a team chat of a project, a note of another project is left out, as in the lookup. Each host is handed once in a run: opening it again, or a page of it, brings the notes no more. An address that is not a website (a blank page, an IP address) has none.
- **What is handed is a record.** The notes are printed with `noteLine` (who said it and when), inside `<site-notes>`, said to be records and not instructions, and made inert (ADR 014): a note cannot close its block. The run's record names the notes handed over in `meta.relevant`, beside those of the lookup. A removed, a forgotten or an ended note is in no table this reads, so it never arrives, and another bot's own notes and the Chief's are never read.
- **The source rules do not change** (ADR 015). A note saved after reading a page is still `outside`: handing it with the page does not make it more, or less, trusted than any other note.
- **The bots are told.** A bot with a computer is told in its instructions to give `site` to a note about one website, and what it does. A bot that has no `site` on a note loses nothing: the lookup and recall find it as before.

## Alternatives

- **Hand the notes with every snapshot.** The bot would read the same lines again and again. Once per host in a run says them when they are new.
- **Match words of the note against the page.** The lookup already does that for the task's words; a page's host is exact, and costs no search.
- **Hand the notes at the start of the run, for every site a note names.** The run does not know yet which sites it will open, and it would hand over notes about sites it never visits.
- **Let the bot ask for them (a tool).** It would have to know to ask; the point is the note that arrives when it does not.
- **Public suffix list.** `login.energa.pl` reaches `energa.pl` by removing labels, and stops at two. A site such as `co.uk` is a note a bot could save, and then it would reach every page under `co.uk`; the bot gave it, and the cap of five bounds the harm. No list is shipped for that.

## Consequences

- One more column on three tables, announced by `SCHEMA_VERSION`; a database from before gets it at the next start.
- The answers of `open_browser` and `browser_goto` can be longer by up to five lines, once for each host in a run.
- A run's `relevant` can name notes the lookup did not, so a replay's inputs (`lib/outcomes.js`) list them too.
- The apps need nothing: a note's `site` is one more field they ignore (`docs/api.md`, Memory).
