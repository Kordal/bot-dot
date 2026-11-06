# ADR-167: The owner's message to a Chief that replies is sorted like a bot's

- **Status:** Accepted (2026-11-07)
- **Owning task:** [#1102](https://github.com/Kordal/bot-dot/issues/1102)
- **Builds on:** [ADR 106](106-a-follow-up-to-a-bot-at-work-goes-into-the-run-it-belongs-to.md) (a follow-up to a bot at work), [ADR 040](040-a-waiting-message-is-steered-into-the-run-at-its-next-tool-call.md) (Steer), [ADR 063](063-a-btw-question-is-answered-without-tools-beside-the-run.md) ("/btw")
- **Changes:** Milestone 7's "the owner's message to a replying Chief waits its turn" (ADR 011 for the Chief)

## Context

While the Chief works (creating a bot, setting jobs, waiting for a run), a quick correction such as "make it 9, not 8", "also add Slack" or "how far are you?" waited until the whole turn ended and then started a new turn, which redid or undid that work. It reached the running turn only when the owner pressed Steer or typed "/btw". For a bot's runs the same messages are sorted automatically (ADR 106), 38 to 40 of 40 right on the bench.

## Decision

- **The owner's message to a Chief chat whose reply the owner started, and is still being written, is sorted first** by the same sorting as a bot's (`lib/follow-up.js`, the model the admin chose, the same strict fallback), with the reply's request, how long ago it started, its working line and plan, and the chat's last lines:
  - **steer**: it waits steered into that reply, as after Steer, and the turn reads it at its next tool call. The turn is told botdot took it for more of this reply's work, not that the owner pressed Steer.
  - **ask**: it is answered aside, as a "/btw", beside the reply.
  - **new**, a failure, a late or unsure answer: it waits its turn, as before.
- **Not sorted:** a message with files, a skill command or "/btw"; one sent while another of the owner's already waits in that chat, so they keep the order sent; a reply botdot started (a bot's result, a reminder). Messages of one chat are sorted one at a time; the same key sent again meanwhile gets the message already taken.
- **Nothing new to draw.** The apps already draw a steered waiting message and a "/btw" pair; `BOT_DOT_FOLLOW_UP=off` switches it off, as for bots.

## Alternatives

- **Keep the owner's message waiting (Milestone 7).** Rejected: a correction then redoes the whole turn's work, and Steer is a button the owner has to know about.
- **End the Chief's wait for a run only** (already the case: the owner's message ends `wait_for_run` at once). Not enough: outside a wait the turn still runs to its end with the old request.

## Consequences

- A message sent while the Chief replies takes the sorting's time before its answer (about 1.4 s with Haiku), and one small model call more.
- A wrong steer is visible, steered in the waiting list until read, and the reply answers it; a wrong "new" is what happened before.
