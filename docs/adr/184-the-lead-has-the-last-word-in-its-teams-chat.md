# ADR-184: The lead has the last word in its team's chat

- **Status:** Accepted (2026-11-10, the owner: "ok go as recommended", on the audit of how bots work together in a team's chat)
- **Builds on:** [ADR 019](019-the-botdot-server-gives-the-turns-in-a-group.md), [ADR 081](081-a-short-model-call-picks-who-answers-a-group-message-without-a-mention.md), [ADR 119](119-a-teams-chat-is-a-group-that-follows-the-team-and-a-message-without-a-mention-goes-to-its-lead.md), [ADR 148](148-the-owner-talks-to-a-team-through-its-lead.md)

## Context

In a team's chat the router gives a message to up to two members (ADR 119, as amended by #759), and they answer one after another. Each answered the owner on its own: the second was told to say what the first had "missing or wrong", so it corrected it in front of the owner; a member could not ask another for a fact while answering a question ("hand none on"); every choice went back to the owner as options. Nothing put the replies together: a line ended with its last reply, and the lead, told to "collect what they reply", was given no turn to do it. The owner saw two partly conflicting answers and two questions where a team should give one answer.

## Decision

- **The lead's last word.** When a line of a team's chat ends, two or more members replied and the last reply is not the lead's, botdot gives the lead one more turn (`closing` on the turn, once a message). It is told to write the team's one answer: the result, what the team decided and why, who does what next; never to retell each reply nor to hand the owner options; where members disagree, to decide; to ask the owner only for what only the owner can give, as one recommendation and one yes or no question. Not for `@all`, a member's post, a line "Stop all" ended or one stopped at the limit, nor when the lead is paused or gone. One member alone answering is the team's answer as it is.
- **The team's answer is folded over.** The message keeps `answer`: the lead's last word, or the lead's reply that ended the line after members spoke. The web page and Android fold the replies before it under one row of their heads and names, which opens them.
- **A member speaks to its lead.** A member's turn in a team's chat is told that the lead writes the team's answer after it and the owner sees its reply folded: facts, its part and its recommendation, no question to the owner. A member that disagrees with another names it with the fact, so that it corrects its own part (it gets a turn by the hand-on), and never corrects it for the owner.
- **A question can ask a teammate for a fact,** in any group: the turn still does no work for a question, but may name a member to ask it for what it needs to know.
- **A team decides what is its own.** Every team bot, in its own chat and in a turn, is told to decide as a team what is technical, can be undone and costs nothing, and to say what it chose; the owner is asked only for money, an access or a key, a step that cannot be undone, or a matter of taste, with one recommendation. Cards are unchanged: what only the owner's tap allows still asks for it (ADR 054-056, ADR 148).

## Alternatives

- **The lead first, always, splitting the work.** Rejected: the owner chose the router for a team's chat (#759); the last word gives the team one voice whoever the router picks.
- **The members' replies hidden.** Rejected: the owner can open them, and a member's reply can be the thing asked for.
- **A last word after every line, one member alone included.** Rejected: one reply needs no summary, and it costs a run.

## Consequences

- A message two or more members answered costs one more run of the lead, some 10 to 25 seconds.
- An older app draws every reply; an older server sends no `answer`, and nothing is folded.
- A team bot's note grows by some 300 characters (DECISIONS.md, 2026-11-10).
