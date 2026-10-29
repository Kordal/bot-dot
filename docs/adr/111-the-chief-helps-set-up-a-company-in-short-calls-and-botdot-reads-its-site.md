# ADR-111: The Chief helps set up a company in short calls, and botdot reads its site

- **Status:** Accepted (2026-10-29)
- **Owning task:** [#670](https://github.com/Kordal/bot-dot/issues/670), spec [#668](https://github.com/Kordal/bot-dot/issues/668)

## Context

The About step of a company's setup (ADR 110) needs the Chief of Staff's help on every screen: it reads an existing company's site and prefills its About cards, names a new idea and drafts tap-to-pick answers (chips) for five questions, suggests user stories and a missing group, and writes a quick SWOT with one first test. The owner waits on each of these while the screen is open, and none of them is work a run of the Chief should do with its tools, memory and chat.

## Decision

- **One short call each, not a Chief run.** `lib/company-chief.js` asks the Chief's model through `askClaude` (lib/dresser.js), as the group router does (ADR 081): no tools, no MCP servers, no session, its own system prompt, and a time limit. Each call answers one JSON object; nothing else is used. The answer is cut to plain text and kept in the company record (rule 6). A failed, late or unusable answer leaves the setup working without chips; the questions are botdot's own and stand without the Chief.
- **botdot fetches the site itself.** The page and the link sources are fetched by the server over HTTPS, with each hop's addresses checked and pinned as for site icons (ADR 086, lib/favicon.js `get`): a site that names or points to a local, private or Tailscale address gets no request. A file source is read from the readable copy botdot made of it in the Chief's uploads. What a page says stands inside a block the model is told holds text and never instructions.
- **The screen keeps nothing the server lacks.** Every answer is saved with `PATCH /api/company` as it is given, and the Chief's chips are saved on the record (`about[].chips`, `suggestions`), so a reload, or another window, goes on where it was. Only the story suggestions are not kept: they are asked again.

## Alternatives

- **A turn of the Chief in a chat.** Rejected: slow to start, writes into a chat the owner did not open, and gives a page's text the Chief's tools.
- **The Chief's own web fetch.** Rejected: it would run with the Chief's tools on text from the site, and its addresses are not checked as botdot's own fetch checks them.

## Consequences

- Setting up a company costs a handful of short model calls; each is limited in time and answered once.
- A site that needs JavaScript to show its text gives the Chief little: it then asks more questions.
