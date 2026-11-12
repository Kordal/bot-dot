# ADR-219: A member in a group asks a bot outside it and waits for its answer

- **Status:** Accepted (2026-11-12, the owner: "Jak bot czegoś nie wie, ale wie że inny bot może pomóc, to powinien móc do niego napisać z własnego czatu", and on the card: yes, in teams' and groups' chats too)
- **Changes:** #759 (a group's turn has no `message_bot`): it still has none, and gets `ask_bot` for bots that are not members. ADR 192 (every bot may ask every other bot) now holds in a group's turn too.

## Context

In a bot's own chat a bot that doesn't know something asks a teammate with `message_bot` and finishes once the answer comes back (#136, #225, #465). A turn in a group or a team's chat has no `message_bot` (#759): its answer would land in the bots' own chats, never in the group, and the turn had ended by then. A member could only hand work to other members by naming them, so a team bot could not ask, say, the mail bot outside its team.

## Decision

- **`ask_bot(to, question, files?)`, in a group's turn only** (`SELF_ASK`), for the bots the member may message that are not members of that group. Members are still named with "@". The turn's prompt lists those bots with their description and reach, and tells it to ask before saying something isn't known.
- **The turn waits for the answer inside the tool call**, up to ten minutes, and then answers the group with it. Nothing has to come back into the group later: the answer is part of the member's own reply. `POST /api/self/session/ask-bot` starts or queues the asked bot's run (`{ runId, status, to }`) and `POST /api/self/session/ask-bot-answer` waits up to 25 s at a time for it to end (`{ done, status, reply, problem }`).
- **The asked bot works in its own chat**, started like any bot's message (`trigger: "bot"`, `fromBot` with `group: { id, name, runId }`), told that its reply alone goes back to the asker and that it must not message it back. While the asker's turn waits its reply is `notificationAudience: "internal"` (folded, no notification); after the asker gave up, it is the owner's.
- **The group shows the exchange folded:** the turn's run has `asked: [{ runId, id, name, emoji, color, text, at, reply?, status?, endedAt? }]`, and the apps draw one folded line per ask, "Asked Mail Steward" with its head and the answer's first words, above the member's reply.
- **Bounded:** at most 3 asks a turn, the chain's hop limit (20) holds, and the asked bot cannot ask back into the waiting turn (it has no `replyTo`).

## Alternatives

- **`message_bot` in a group's turn, with the answer starting a new turn of the asker in the group.** Rejected for now: a follow-up turn in a group needs a message of the owner's to belong to, the 12-reply line, the router and the lead's last word; the answer would arrive as a second reply after the member already answered.
- **Showing the asked bot's reply in the group under its own name.** Rejected: it is not a member, and its turn would count in the line.

## Consequences

- A member's turn can take up to ten minutes longer while it waits; the group shows it at work meanwhile.
- An answer that takes longer stays in the asked bot's own chat, as the owner's; the member says so in one line.
