# ADR-258: A bot asks the owner to go to its computer with a card on its reply

- **Status:** Accepted (2026-11-20, the owner's approved mockup of the Go to computer card)
- **Builds on:** [ADR 225](225-a-bot-asks-before-the-owner-signs-in-on-its-screen-and-im-done-hands-it-back.md) (ask first, "I'm done" hands the screen back), [ADR 009](009-the-botdot-server-carries-on-after-an-ok.md) (carry on)
- **Leaves as it is:** [ADR 252](252-a-card-stands-in-the-chat-that-names-it.md) (cards of Needs you, named by id)

## Context

When a bot needs the owner to act by hand on its computer (sign in, approve a prompt, plug something in), it wrote the steps as a numbered list in prose, and the owner answered with free text ("Yes I'm ready"). Nothing in the chat said whether the step was done, and the bot's carry-on rode on the screen's "I'm done" or on a message.

## Decision

- **The bot calls `go_to_computer`** (a tool of its computer, `lib/computer-mcp.js`) with `steps` (1 to 6 short lines), `current` (the step the owner is on, counting from 1; those before it show as done), and optionally `title`, `compact` (one quick step) and `minutes`. botdot validates it as text (`lib/computer-card.js`) and keeps it on the bot's run as `goTo`, with the bot's computer (`place`: `linux` or `boat`), `state` `waiting` and the time. One card per run. The computer stays on for the step, as `keep_computer_on` does. The bot's prompt says to call it instead of writing a list, and to end with one line.
- **The card is part of the run, not an ask.** It is not in Needs you and is no card of ADR 252: a card of Needs you that is answered goes from the list, while this one stays in the chat's history as one line ("You confirmed · 14:32"), and the run keeps its state across restarts and every redraw. A turn in a group has none: the tool says so, and the bot writes it in its reply.
- **The owner answers on it**: `POST /api/bots/:id/computer/card` with `{ run, answer }`, `done` ("I'm done") or `later` ("Not now"). The answer is kept on the run, and the bot carries on from that run by the rules of "I'm done" (ADR 225), told which it was: `done` as the screen's "I'm done" tells it, `later` as a declined step to do without and not to ask again. "Take over screen" opens the bot's screen as it opens today. The screen's own "I'm done" answers a waiting card of the run it carries on.
- **Web only for now.** Announced in `features` as `computer-card`; an app that does not know `goTo` ignores it, and the bot's line under its reply still says what waits.

## Alternatives

- **An ask in Needs you** (a new kind beside `computer-step`): rejected, because the answered card must stay in the chat as history, and the owner has not decided yet to list it on the group page's Needs you.
- **A marker line in the reply** (`[[go: …]]`, as `[[ask: …]]`): rejected: the steps, the current step and the flags are structured, and a tool call is validated and refused in the bot's own words.
- **"Not now" as nothing**: rejected: the bot would wait for a step the owner has put off; it is told and does without.

## Consequences

- A bot that never calls the tool still works as ADR 225 says.
- A waiting card stays waiting if the owner never answers; after a day the bot has no run to carry on from, and the answer says so ("Write to it in its chat").
- Android and iOS draw nothing until they catch up; the Needs you list of a group page does not show it.
