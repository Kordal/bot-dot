# ADR-229: A team's chat asks the owner once, and a handed-on member brings its result

- **Status:** Accepted (2026-11-13, the owner: "Yes do it", on the review of the Botdot Launch team's chat of 12 Nov 2026)
- **Amends:** [ADR 201](201-the-lead-has-the-last-word-in-its-teams-chat.md) (the lead's last word) and [ADR 218](218-in-a-chat-the-owner-reads-a-bot-asks-the-owner-itself.md) ("the lead does not ask again"), in a team's chat; [#489](https://github.com/Kordal/bot-dot/issues/489) (a handed-on turn was told nothing about restating)

## Context

On 12 Nov 2026 the owner wrote 88 messages to the Botdot Launch team's chat and its seven bots answered with 225 runs. In 17 messages two or three replies each ended with a question to the owner; three bots asked the owner for the same contact address within one message. The lead's last word handed work on 19 times in 11 messages: 7 of those turns did the work, 7 passed, and 5 restated the team's answer or asked the owner again under it. A member handed the work on was told nothing about repeating what it read, so one test plan stood in all seven replies to one message.

## Decision

- **One question to the owner per message.** The lead's last word answers itself what the owner already said or decided, and puts what still stands into its one question at the end: the one the owner answers for that message (the group's open question, ADR 211, is the newest reply that asks). A member still asks the owner itself (ADR 218) when it alone answers; it never asks what another member already asked in the chat, and says in a line that it waits for that answer.
- **After the lead's last word, a member brings its result.** A turn the last word handed on (`afterClosing`, read from the message's turns) is told that the team's answer is written and its reply is folded under it: only the result of its part, with its link, or a pass; no plan, no status, no question to the owner.
- **A handed-on member restates nothing.** Every turn a member's reply handed on (not a member's post) is told never to restate what a member said in the chat (a plan, steps, the owner's choices, where things stand) and to give only its part, done or what it still needs. It is not told to pass when all is said: it has work from the member that named it (#489).

## Alternatives

- **Members never ask the owner in a team's chat, the lead asks for them.** Rejected for now: a member that alone answers has no last word after it, and its question would be lost.
- **No hand-on in the lead's last word.** Rejected: 7 of its 19 hand-ons on 12 Nov were the work itself (PR #1280 among them).
- **One line at a time in a team's chat, and the open tasks in the group's notes.** Left for a second change, after a day of data on this one.

## Consequences

- Prompt-only change: no API, no app change; a team bot's turn grows by some 250 to 600 characters.
- The lead's last word asks again what a member asked, as the one question of the message: the owner may read it twice, once folded.
- How well the rules are kept depends on the model: the review saw it at its worst on Haiku.
