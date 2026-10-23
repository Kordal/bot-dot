# ADR-078: A mentioned page or tile is handed to the run

- **Status:** Accepted (by the owner, 2026-10-23)
- **Owning task:** [#473](https://github.com/Kordal/bot-dot/issues/473)
- **Changes:** what a mention is (CONTEXT.md, "Mention"): a reference only, until now

## Context

A mention named a bot, a job or a skill, and the run was told only what it named. The owner wants to write "@IssueList take all remaining issues and solve them" and have the bot work from that page, also when another bot wrote it, and the same for a tile of the Board. A bot reads only its own workspace: another bot's page and the Board are out of its reach.

## Decision

- **A page and a tile can be mentioned** by their title, written as a mention writes a bot's name (`Issue list` -> `@IssueList`), and a page also as `@Bot/Title`. For one name a bot wins, then a page (the chat's own bot's first), then a tile, then a skill, so nothing that worked before changes. A page's tile and a group of tiles are no tile mention. The rules are public/mentions.js and test/fixtures/mentions.json, as for every mention.
- **The botdot server hands what it holds now to the run that answers,** in the note about the owner's mentions: a page's text (its blocks written out as text, as a document reads them), a tile's value and what it last read. It is fenced as content, never orders, and cut at 20,000 characters a page and 60,000 for all of them. An interactive page is named, without its site.
- **In a group every turn of the message gets it.** A page or tile mention gives nobody a turn; `@Member/Page` names that member, as `@Member/Job` does.
- **Only what the account has.** The server is the account's: its pages and its Board, nothing of other accounts, no stored value of the vault. Never in a shared room.
- **The apps offer them on a botdot with `page-mentions`:** pages from `GET /api/pages`, tiles from the Board. A mention typed by hand works on the server without it.

## Alternatives

- **Give the bot a tool to read any page.** It would have to guess which page the owner meant, and every bot would read every page. Rejected: the mention says which one, and the owner's message is the consent.
- **A copy of the page's file in the bot's workspace.** A stale file left behind, and a write to it changes nothing. Rejected.
- **Pages before skills only in the suggestions, skills first in matching.** Two orders to learn. Rejected: one order for both.
