# ADR-080: A long turn in a group goes on in the background

- **Status:** Accepted (asked for by the owner, 2026-10-23)
- **Owning task:** [#509](https://github.com/Kordal/bot-dot/issues/509)
- **Changes:** [ADR 019](019-the-botdot-server-gives-the-turns-in-a-group.md) ("One turn of a message is at work at a time"), [ADR 079](079-a-later-message-in-a-group-waits-for-the-line-before-it.md) (a later message waits for the line before it)

## Context

The line of a message gives its next turn only when the run of the turn before it has ended (ADR 019), and since ADR 079 the owner's next message with one of the same members waits too. A member given a long task (a build, a long search, minutes of tool calls) held up every member after it and every message the owner wrote meanwhile. The owner saw a group stand still behind one bot.

A bot may run three runs at once ([ADR 062](062-a-message-to-a-busy-bot-starts-beside-the-run-that-is-going.md)), so nothing but the line kept the others waiting.

## Decision

- **A turn holds up its line for at most 90 seconds** (`TURN_MS` in `lib/group-chat.js`; `BOT_DOT_GROUP_TURN_MS` overrides it, for the tests). A turn whose run is still at work then goes on in the background: the turn is marked `background` on the message, and the line gives the next turn. The run is not touched.
- **Its reply lands in the group as it ends,** as any reply: it stands where its run ended (#460), its mentions hand the work on (ADR 019, ADR 077), and it counts towards the 12 replies. The message is done only when that run has ended too.
- **The turns after it are told that its part is taken:** a marked line names each member whose turn of this message works in the background, and `RULES.working` says never to do that part, restate it or name that member to hand it on.
- **A member working in the background holds up nothing:** not a later turn of its message (`held` in `lib/bots.js`), not a later message of the owner's (`ahead`, ADR 079). That member may get a turn of the later message, which starts beside its first run (ADR 062).
- **The members that already answered are not started again by the late reply.** They read it on their next turn, or have a turn when it names them. Starting them all would bring back runs that end with a pass, and loops.
- **`@all`, "Stop all" and the limit are unchanged.** "Stop all" ends a run in the background as any run of the group.
- **The apps need nothing new.** A member at work is already drawn as its own working line under the chat, with its working line as it goes on; a run in the background is one of those lines, beside the next member's.

## Alternatives

- **No time limit, a member says itself that it goes on in the background** (a tool). Rejected: it rests on the model doing so, and a run deep in tool calls does not stop to say it.
- **A short system line in the chat ("X is working on it").** Rejected for now: the working line under the chat says it already, and a second line would be helper text (the owner's UI rule).
- **Start every member again when the late reply lands.** Rejected: most of them would pass, and two members could start each other again without end.
- **Ask a model first who the message is for**, so members with nothing to add do not run. Faster too, but a change of its own; left for later.

## Consequences

- One long task no longer stops a group: the other members answer within seconds, and the owner can write again at once.
- The members after a long turn do not read its result before answering, only that it is being worked on.
- A member can have two runs of one group at once: its turn in the background and a turn of a later message.
