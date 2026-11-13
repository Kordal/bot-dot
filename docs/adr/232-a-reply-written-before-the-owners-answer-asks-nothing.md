# ADR-232: A reply written before the owner's answer asks nothing

- **Status:** Accepted (2026-11-13, the owner: "Both", then "drop fix 2", on the Botdot Launch team's chat of that morning)
- **Amends:** [ADR 229](229-a-teams-chat-asks-the-owner-once-and-a-handed-on-member-brings-its-result.md) and [ADR 211](211-a-bot-asks-in-one-place-at-a-time.md) (the group's open question)

## Context

The owner, on 13 Nov 2026: "I already replied and another bot is asking again about it?" In the Botdot Launch team's chat Website Builder asked "May I publish PR #15?" at 08:59:32. The lead's last word started that same second, the owner tapped "Tak, publikuj" at 08:59:37, and the last word ended at 08:59:49 asking "May Website Builder publish PR #15?" with its buttons, under the owner's answer. The owner's yes had reached Website Builder, which was publishing.

The group's open question was the newest reply that asks and that ended after the owner last wrote. A reply that started before the owner's answer and ended after it was written without that answer, and asked again what the owner had just said.

## Decision

- **A reply written before the owner's answer asks nothing.** When the owner's newest message in a group answers a question (`question`, a tapped answer), a reply that started before that message is no open question, though it ends after it: no buttons, and no "Asks" on the group's row.
- It is narrow on purpose: a message of other words leaves a working member's coming question open, and a reply that starts after the answer asks as before.
- The lead keeps asking again what a member asked (ADR 229): the member's reply is folded under the lead's answer, so without the lead's question the owner would have no buttons in sight.

## Alternatives

- **The lead never repeats a member's open question, and says the team waits for that answer.** Rejected: the member's reply, with the only buttons, is folded under the lead's answer on the web page and in the Android app, so the owner would read "the team waits for your answer" with nothing to tap.
- **Every reply that started before the owner's newest message asks nothing.** Rejected: a member at work while the owner writes about something else may still have a question that stands.

## Consequences

- A server-only change (`asksOf`): the apps draw buttons only under the group's `asks.runId`, so both get it without a change.
- Such a reply still notifies as a question: `notify` is read from the run alone. Left for a follow-up.
- Only a tapped answer, the exact words of a button, counts: a typed "tak" leaves the stale buttons.
- A member whose run started before the answer and asks something new is drawn without buttons too; the owner answers it in words, or the member asks again on its next turn.
