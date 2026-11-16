# ADR-253: A waiting message in a group is steered into the busy member's run

- **Status:** Accepted
- **Owning task:** the owner's request of 16 November 2026: a message in a team's chat waited under "Waits until Infra Admin is free" with only "Take back", while "Steer" was there in a bot's chat and the Chief's
- **Changes:** [ADR 040](040-a-waiting-message-is-steered-into-the-run-at-its-next-tool-call.md) ("Groups stay out: a group keeps its own waiting list"; "Not a turn in a group")
- **Builds on:** [ADR 019](019-the-botdot-server-gives-the-turns-in-a-group.md) (the line of turns, a turn waits in its member's queue), [ADR 119](119-a-teams-chat-is-a-group-that-follows-the-team-and-a-message-without-a-mention-goes-to-its-lead.md) (a team's chat is a group)

## Context

A project's team chat is a group (ADR 119). The owner writes there while a member, usually the lead, is at work on an earlier message, and the new message waits: "Waits until Infra Admin is free" and "Take back". Steer (ADR 040) hands such a message to the run that is going, which reads it at its next tool call and changes course in the same run. A bot's chat and a Chief chat had it; a group did not, so in a team's chat the owner could only wait, or take the message back and stop everything.

A message waits in a group in two ways: its turn is in a busy member's queue (the member is at work in its own chat, or in a turn that went on in the background), or its line has not begun because an earlier message's line still has that member (ADR 019, #489).

## Decision

- **Steer is the owner's press on a waiting message of a group**, beside "Take back": `POST /api/group-chats/:id/messages/:messageId/steer`, with `group-steer` in `features`. It hands the message to the run of each busy member it waits for, which reads it at its next tool call, in the same run.
- **Only a run in the same group takes it.** The member's reply to a steered message is that run's reply, so it must stand in the chat where the owner wrote. A member who is busy in its own chat, in another group, or on something the Chief asked answers `409` with a sentence ("<Name> is working in another chat. This starts when it is free."); the message keeps waiting. Runs that may take it are the member's turns in the group that have tools, as a bot's own run is steerable (ADR 040): not a run without tools, a teammate's request or a task of the Chief's.
- **It is marked on the member's turn, as in ADR 040.** A turn that waits in the queue gets `steering: <run id>`; a message whose line has not begun gets its turn for each busy member given now, marked, and the members that were free go on with the line as it would. The turn stays in the queue, on disk, until the run reads it; a turn that is steered starts beside no run.
- **Read, it is the run's.** The run's record has the message in `steered`; the member's turn of it is read and no turn is given again; the message is an ordinary message of the chat (it cannot be taken back or steered any more); its line is over when no member waits for it. The member's reply stands where the run's does, under the message that run was started for. The run is told in botdot's words that the owner wrote in the group chat, with the message and its files, as ADR 040 does for a bot's chat. A run that waits inside a tool for the owner's answer (a login request, a card) ends the wait when something is steered into it (ADR 228).
- **Not read before the run ends:** the mark goes, the turn waits as any turn and starts as its own turn when its member is free, once. After a restart the same.
- **Take back works until it is read:** its waiting turns leave their queues and the run never sees the message.
- **What the apps see.** A message has `steering`, the ids of the members steered to and not read yet, while it waits; `waitsFor` lists only those not steered. The apps draw "Steering…" in place of "Waits until … is free" once nobody is left to wait for, with "Take back" alone; while some member is still to be steered to, "Steer" stays. Pressed again: the members not marked yet are tried; `409` when none can take it and none was marked.
- **The Project Manager's message and a member's post** are not the owner's to steer: `404`.

## Alternatives

- **Steer into any run of the member, in whatever chat.** Rejected: the answer would stand in a chat where the owner did not write, and the owner would see a message in the group and no reply to it there.
- **Start the member's turn beside the run that is going.** Rejected: ADR 062 does it for a bot's own chat, but a group's turns of one member read each other's replies (ADR 019, #489) so that no member answers two lines at once; steering keeps that, and the run's work is not repeated.
- **Steer by default, without a press.** Rejected for the reason ADR 040 gives: a message is often the next task, not a change to this one. ADR 106's sorting is for the bot's own chat; a group's messages are not sorted.

## Consequences

- Every turn of a group that has tools may now read a steered message at its next tool call, as a run in a bot's own chat can (the hook was already in its settings).
- A member's run that makes no more tool calls before its reply never reads it: the message then starts as its own turn, as if it had not been steered.
- The run that read it holds the message in its record (`steered`); the group's chat draws it once, as the owner's message where it was written, and not again with the reply.
- `steering` is new on a group's message and `group-steer` in `features` (docs/api.md, "Steer in a group"). The iOS app catches up with the Android app ([#1355](https://github.com/Kordal/bot-dot/issues/1355)).
