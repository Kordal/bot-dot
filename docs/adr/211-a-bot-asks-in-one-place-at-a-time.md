# ADR-211: A bot asks in one place at a time

- **Status:** Accepted (2026-11-10, the owner: "Sometimes the question to the same topic was answered in another chat. So in this chat the question choices should disappear")
- **Supersedes in part:** [ADR 020](020-a-member-reads-the-groups-chat-and-keeps-its-own-memory.md) ("A group's turn leaves the bot's own open question alone")
- **Builds on:** [ADR 018](018-a-group-is-a-chat-of-its-own-and-a-turn-is-a-run-of-its-member.md), [ADR 020](020-a-member-reads-the-groups-chat-and-keeps-its-own-memory.md)

## Context

A bot's question in its own chat and a member's question in a group were two questions that never met: the owner's message in one chat ended only the question of that chat. A bot in its own chat and in two team chats could ask the same thing in each; the owner answered once, and the other chats kept the answer buttons, "Asks" on their row and the bot in Needs you, for a question that was settled.

## Decision

- **A bot's question is open only while nothing newer passed between the owner and that bot elsewhere.** Nothing is kept for it: it is still read from the runs, the queue and the group's messages, so a reload and a restart show the same.
- **Its question in its own chat** also ends once the bot takes a turn in a group after it: a turn at work, or one that replied (a pass is no reply, and gives the question back).
- **A member's question in a group** also ends once the owner, or the Chief, writes to that bot in its own chat (a message that waits its turn too), the bot replies in its own chat, or it takes a turn in another group, as above.
- **The feed says each end where it is seen:** `asks` for the bot's own chat and `group_asks` for each of its groups, whenever one of its runs starts, ends or its queue changes.
- **The answer buttons follow the open question.** The web page and Android draw them under a reply that asked (`asks: true`) only while it is the bot's `asks.runId` (own chat) or the group's `asks.runId` (group); a reply that asks nothing keeps them under the last reply as before.

## Alternatives

- **Match the topic of the questions** (the same words, or a small model call). Rejected: the words differ between chats, and a model call for every owner's message costs a run for buttons the owner can do without.
- **Any owner's message in any group with the bot ends its questions.** Rejected: in a team's chat the router gives most messages to one or two members, and the others' questions would end for messages they never answered.

## Consequences

- A question can end while its answer is still to come: the owner who wanted to tap a button in the older chat types the answer instead, or the bot asks again where it now speaks.
- A question asked by a lead for a member (ADR 201) is the lead's, and the member's own question is not ended by the owner's answer to the lead.
- An older app shows the buttons under the last reply of the bot's own chat as before; an older server never ends a question elsewhere.
