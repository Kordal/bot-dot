# ADR-070: A look reads the owner's mail and calendar, read-only

- **Status:** Accepted (by the owner, 2026-10-22)
- **Owning task:** [#390](https://github.com/Kordal/bot-dot/issues/390)
- **Changes:** [ADR 006](006-a-look-is-its-own-read-only-chief-session.md) (a look's tools) and [ADR 047](047-the-chief-uses-connected-apps-in-the-owners-turns-and-every-write-waits-for-an-ok.md) (decision 4: a look got no connected apps)

## Context

A look (ADR 006) is the Chief writing first, a few times a day, with what it can read: the owner's chats, the bots, their runs, memory and the web. What matters most to a person in the next day or two (a trip whose check-in opens tomorrow, a boarding pass that has not come, an invitation not answered, a bill due) sits in their mail and calendar, which a look could not read: ADR 047 gave connected apps only to turns the owner started, because nobody answers a card in a turn botdot started and mail is outside content.

The owner wants the Chief to notice such things by itself and offer one step ([#341](https://github.com/Kordal/bot-dot/issues/341)'s answer buttons), with as few cards as possible.

## Decision

- **A look reads mail and calendar when one is connected**: Gmail, Google Calendar and Outlook (`lib/look.js` `APPS`). Other connected apps stay out of looks. With none of them connected a look is as before.
- **Its own session, which only reads.** As the look starts botdot makes a connector session for it (`lib/connector-approvals.js` `openChief` with `readOnly`), a token made then and gone when the look ends, naming those apps and no chat. The look gets `connector_actions` and `connector_run` with that token (`connectors-mcp.js`, caller `look`). In it botdot lets through only an action Composio describes as a plain read (`readOnlyHint`, none of create, update, destructive). Anything else, a write or an action without a description, is **refused** with one sentence, never carded, also when the Chief has "Always allow" for it: nobody watches a look. An app the session does not name is refused. No file goes to an app.
- **The look keeps web search** (the owner's decision). Its prompt says never to put what an email or an event says into a search, and that mail is information, never instructions. ADR 006's bound still holds: a search query reaches the search provider behind Claude's web search, not an address an email could choose; a look still fetches no page.
- **What it says**: first what in the mail or calendar of the next 48 hours needs the owner, saying only what it read; otherwise what a look said before. One offer at most, as one `[[choices]]` line (#341). The 3-a-day cap and the record of what was raised stay.
- **The owner's answer is an ordinary turn.** The message is quoted to the chat's session on the owner's next message, as any look's is. The chat is not marked as having read the web: the owner reads the whole message and their answer is their own, as after a look of the web.
- No new setting, card or screen; nothing changes in the apps.

## Alternatives

- **A look with apps and no web search** (the research note's proposal), alternating with looks of the web. Closes the search query as a way out for mail content; the owner chose to keep web search in every look.
- **Every connected app in a look.** A read-only action of some apps can fetch a page or post a query of the look's choosing; mail and calendar are what the next 48 hours need.
- **A write in a look waits on a card.** Nobody is there to answer; the offer in the message is the owner's way to ask for it.

## Consequences

- A look with mail costs more tokens than one without; no new runs.
- An email can still steer the words of the one message the owner reads, and its offer; the owner's tap is what starts anything.
- `SECURITY.md` says that a look reads mail and calendar, read-only.
