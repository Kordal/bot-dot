# ADR-074: The Chief drafts replies the owner owes, and a Gmail draft needs no card

- **Status:** Accepted (2026-10-23)
- **Owning task:** [#417](https://github.com/Kordal/bot-dot/issues/417)
- **Changes:** [ADR 047](047-the-chief-uses-connected-apps-in-the-owners-turns-and-every-write-waits-for-an-ok.md) (every write of the Chief waits for an OK)

## Context

A look reads the owner's mail, read-only ([ADR 070](070-a-look-reads-the-owners-mail-and-calendar-read-only.md)). The mail a person most often lets slide is the reply they owe. Spotting it is half the work; the other half is writing the reply, which the Chief can do in the owner's voice once it knows how they write. Then sending must stay a step the owner takes, but making a draft should not cost a card: the owner wants as few as possible, and a draft never leaves the mailbox.

## Decision

- **"Learn how I write"** is a request in a chat the owner started: the Chief reads the last 50 or so sent emails and saves one note, place "everyone", topic "writing style" (greeting, sign-off, length, tone, language, phrases), at most six lines, with no names, addresses or quotes. An existing one is changed, not doubled. It is saved after outside content (an app was read in that turn), as ADR 015 says of anything learnt from outside: it is the owner's mail, not the owner's sentence.
- **A look with mail lists replies owed.** An email written to the owner personally that has waited 2 days or more and is the latest in its thread; when the shared memory has the writing style, at most two such replies can be the look's message, each with a short draft in that style and `[[choices]]` Send / Change. The drafts do not count against the 60 words. A draft never promises, accepts or pays. The look still only reads: the draft is text in the message until the owner taps (ADR 070).
- **Send** is the owner's turn: the Chief makes a Gmail draft in that thread and sends it; the send waits for the owner's OK on its card, as every send does. **Change** redrafts.
- **A Gmail draft passes with no card in a Chief turn the owner started** (`GMAIL_CREATE_EMAIL_DRAFT`, `lib/connector-approvals.js` `DRAFTS`). By its slug, whatever Composio's tags say. Sending a draft and every other write wait as before. A bot's draft keeps its card (a bot runs on its own, on schedules), and a look refuses it as any write.

## Alternatives

- **The look makes the drafts in Gmail.** Would put them in the mailbox before the owner looks, but a look is unwatched and only reads (ADR 070); the owner's tap is one step anyway.
- **The style note as the owner's own word.** It would never be unpinned, but text learnt from mail could then speak with the owner's authority to every bot. Saved after outside content instead.
- **Send without a card after the owner tapped Send.** One card fewer; the owner chose to keep every send on a card.
- **Drafts for every mail app.** Outlook's draft actions are left until someone uses them.

## Consequences

- A draft in the owner's mailbox can be made from a turn the owner started without their OK on it; it stays a draft until they send it.
- The style note may be unpinned first when the shared memory is full (ADR 015); it stays searchable, and "learn how I write" makes it again.
- `SECURITY.md` says that a Gmail draft needs no card.
