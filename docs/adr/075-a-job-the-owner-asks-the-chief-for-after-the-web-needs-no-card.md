# ADR-075: A job the owner asks the Chief for after the web needs no card

- **Status:** Accepted (by the owner, 2026-10-23)
- **Owning task:** [#424](https://github.com/Kordal/bot-dot/issues/424)
- **Changes:** [ADR 033](033-the-chief-reads-the-web-and-what-it-changes-after-waits.md) (every change of the Chief's after the web waits), as [ADR 066](066-a-task-the-chief-gives-a-bot-after-the-web-needs-no-card.md) did for a bot's task

## Context

In a Chief chat that read the web (a checkup's chat, a search), the owner wrote "add this job to the E-mail Assistant". The Chief's `add_job` was held as a `chief-action` card: "The Chief read the web in this chat, so this waits for your OK." The owner had just asked for it, so the card was a second tap for one decision. The owner wants as few approvals as possible.

## Decision

- **Not held in the owner's turn.** Adding a bot's job (`POST /api/bots/:id/jobs`) or changing one (`PUT /api/bots/:id/jobs/:jobId`) from the Chief's tools in a chat that read the web goes through at once when the Chief's turn was started by the owner's own message (`standing().startedBy === "owner"`, the test memory and an offered check already use, ADR 017, ADR 064). The server decides it (`ownersJobAfterWeb` in `server.js`), from the turn, not from anything the Chief says.
- **The job keeps the web mark.** Its words may be a page's, so it is saved with `afterWeb: true`, and every run of it starts as one that read the web: `"web"` in `outside`, `readOutside` from its first moment, as a task the Chief gives after the web (ADR 066). A note it saves is "after outside content", a removal from the shared memory or a forget waits, and every card a bot gets in a run still holds. A later change by the Chief or a bot keeps the mark; only the owner's own change of what the job does takes it away.
- **The job's own cards stay.** A script job still waits on its job card, as from any chat of the Chief's; a call or a notify address still waits on its card.
- **Still held after the web:** the same request in a turn botdot started (a checkup, a look, a carry-on after a yes, a late result); removing or running a job; the Chief's own jobs (ADR 073); and every other change ADR 033 holds.
- **The Chief is told** in its instructions that a job the user asked for does not wait, and to set up only what the user asked for, never a page's instructions.

## Alternatives

- **Hold only a job whose words came from the page.** botdot cannot tell which words the Chief took from a page (ADR 066).
- **"Always allow jobs" (ADR 055's way).** One card first, and it would let jobs through in turns nobody typed too.
- **Free every job after the web, as a bot's task is.** A job repeats on its schedule long after the turn; in a turn botdot started nobody asked for it, so the card stays there.

## Consequences

- A page that persuades the Chief in a turn the owner started can set up an AI job for a bot. The job is listed with the bot's jobs, and each of its runs is guarded as a run that read the web: it can do what the bot does unasked, and what reaches outside the account through a guarded route still waits on its card.
- What such a job's runs save to memory is marked as outside content and is the first to leave the pinned notes.
