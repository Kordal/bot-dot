# ADR-079: A later message in a group waits for the line before it

- **Status:** Accepted (asked for by the owner, 2026-10-23)
- **Owning task:** [#489](https://github.com/Kordal/bot-dot/issues/489)
- **Changes:** [ADR 019](019-the-botdot-server-gives-the-turns-in-a-group.md) ("The botdot server keeps the line of turns for each message of the owner's"), [ADR 020](020-a-member-reads-the-groups-chat-and-keeps-its-own-memory.md) (what a turn reads)

Amended by [ADR 080](080-a-long-turn-in-a-group-goes-on-in-the-background.md) (2026-10-23): a turn still at work after 90 seconds goes on in the background; its line, and a later message, go on without it, and its reply hands on when it lands.

## Context

The turns of one message come one after another (ADR 019), and each turn reads the group's chat with the replies before it (ADR 020). Each message has a line of its own, though, and two lines went side by side. Since a bot may run three runs at once (ADR 062), a member no longer waits for itself either. On a live account the owner wrote "Pick the issues you can work on" and, 43 seconds later, "Only the ones assigned to me": the second line started at once, beside the first, with the same members. Two members then answered both messages at the same time, neither reading the other's answer still being written, and the owner got four near-identical lists of issues.

Within one line the later members also restated what the first had said (its split of the work, in their own words): the turn was never told that teammates had already answered this message, and `RULES.answer` ("what belongs to your main assignment and nobody has said yet") read as leave to restate one's own part.

## Decision

- **A message whose line has not begun waits while a line of an earlier message still goes on with one of its members:** a turn of that member at work, still to come, or given and lost. Its line begins when they are done, so each of its turns reads every reply of the earlier line, and no member answers two messages of the owner's at once. A line stopped at the limit holds up nothing (it waits for the owner), and neither does a turn waiting in a busy member's queue (it could wait for hours behind other work).
- **Lines without a member in common still go side by side:** "@Anna the first thing" and "@Ben the second thing" are two lines at work at once, as before.
- **`@all` is unchanged:** its turns are given at once, never waiting for each other; it waits like any message for an earlier line with its members.
- **While it waits, `waitsFor` names those members,** as for a member who is busy, so the apps say the message waits for them with no change. The owner can still take it back.
- **A later turn of the owner's message is told who answered it before** (marked lines, ADR 020), **and `RULES.after`:** read their replies first, never repeat or restate what one of them said (not as a summary, a list or one's own split of the work, not to agree or to confirm one's part), say only what is new, and pass when they said it all. In the group's chat a teammate's reply to this message says "replied to the message you are answering now". A handed-on turn is not told so: it has work from the member that named it.

## Alternatives

- **Join the second message to the running line.** The later members would answer both at once. Rejected: a line holds one message of the owner's (its limit, its hand-ons, Take back), and joining would change all of them.
- **Every message waits for every earlier line, members in common or not.** Simpler. Rejected: two unrelated questions to two different members would wait for each other for nothing.
- **Only the prompt rule.** Rejected: it cannot help a turn read a reply that is still being written.
- **One run at a time for a member in a group.** Rejected: it would bring back ADR 011 for groups and hold up a member's own chat.

## Consequences

- A second message sent while the members are still answering the first is answered later, after them, and its answers build on theirs.
- The prompt of a later turn is a few lines longer.
