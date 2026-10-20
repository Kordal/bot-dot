# ADR-040: A waiting message is steered into the run that is going, at its next tool call, by the owner's press

- **Status:** Accepted
- **Owning task:** [#173](https://github.com/Kordal/bot-dot/issues/173)

## Context

[ADR 011](011-a-bot-does-one-thing-at-a-time-and-the-owners-message-waits.md) keeps the owner's message to a working bot on the botdot server and starts it as its own run when the bot is free: "A message waits for the next run or turn. It is not handed to one that is going." It rejected handing it over (`claude -p --input-format stream-json`, as Claude Code and Codex steer a turn) for that milestone. The only way to get a waiting message read sooner is Stop, which throws away the work the run did.

On 2026-10-20 the owner asked for a second way: a "Steer" button under a waiting message, next to "Take back". A press hands that message to the run that is going, which reads it at its next tool call and changes course in the same run. Without a press a message waits as before. The issue covers the bots and the Chief; this decision is for the bots, and the Chief follows under its own heading.

A spike on Claude Code 2.1.304 (`claude -p`, Haiku) tried the two ways to get a message into a turn that is going:

- **An open stdin** (`--input-format stream-json --replay-user-messages`, a user message written mid-turn). Written while a tool runs, it is read after that tool, in the same turn. But it cannot be taken back once written. Written while the last answer is being made, it is echoed back (`--replay-user-messages`, `command_lifecycle: completed`) and never read: the answer that follows was begun before it. Written a moment later, after the turn's `result`, Claude Code starts a second turn on it by itself, so botdot would have to kill the process to keep the message for its own run. Neither the echo nor the lifecycle says whether the model saw it.
- **A `PostToolUse` hook** that botdot gives the run in `--settings`. It runs after every tool call, before the next request to the model, and its `additionalContext` goes into that request. A hook that asked a file for a message delivered it after the next tool, and the model acted on it in the same turn ("Now running the additional command from your message").

## Decision

- **Steer is the owner's press, on one waiting message.** `POST /api/bots/:id/queued/:queuedId/steer`. The message stays in the queue, on disk, marked as steered into the run that is going (`steering`, that run's id), until that run reads it. A message without a press waits as ADR 011 decides. So ADR 011's "It is not handed to one that is going" now reads: not unless the owner presses Steer on it.
- **The run reads it through a hook, at its next tool call.** A run that may be steered is started with a `PostToolUse` hook (`lib/steer-hook.js`, in a private settings file beside its MCP file, with the run's key). After each tool call the hook asks botdot for what was steered into its run (`POST /api/self/session/steer`). botdot takes those messages out of the queue and onto the run's record in the same step, and answers with them in botdot's words; the hook hands that to Claude as context for its next step. The server alone decides when a message is read, so it is read once or not at all.
- **stdin stays closed.** A run is still one prompt on its input, closed at once (ADR 011). No process stays open between turns, and nothing is written into a run that botdot can't take back.
- **Take back works until it is read.** A steered message is still the owner's waiting message: Take back answers its text and files, and the run never sees it.
- **Not read before the run ends: it starts as its own run.** When the run ends, its steered messages that were not read lose the mark and wait as any message; the oldest of the owner's starts next, as ADR 011 orders them. After a restart the mark is gone too: the run it was for is `interrupted`, and the message starts once, in its order.
- **The run keeps what it read.** Its record has `steered`, the messages it read, in the order read: `{ id, text, attachments, at, readAt }`, `id` being the id the message waited under and `at` when it was sent. The chat shows them after the run's request, as the owner's messages, without buttons. A later run is given them in its history, after the request of the run that read them. For the rules of [ADR 009](009-the-botdot-server-carries-on-after-an-ok.md) each counts as a message the owner sent the bot from `at`, as it did while it waited.
- **Which runs can be steered.** A run in the bot's own chat that answers the owner: the owner's message, a Board tile's request, a job's run, a run that carries on. Not a turn in a group (another chat), a teammate's message or a run the Chief asked for (their reply goes to who asked), nor a run without tools, as the memory review or a new bot's first message (no tool call comes). Steer on a bot whose run can't take it answers `409` with a sentence, and the message keeps waiting.
- **What the apps see.** A waiting message that was steered has `steering: true` in `queued`, and the apps show "Steering…" in place of "Waits until … is free", with Take back. A run that read one is announced on the feed (`run_steered`, with the run's `steered`), and `steered` is on the run in every answer. `features` has `steer`; an app that does not find it shows no button.

Resolved for the Chief by its own ticket, under its own heading here.

## Alternatives

- **An open stdin with `--input-format stream-json`**, as the issue proposed. Not chosen, from the spike: a written message can't be taken back, can be echoed and still never read, and with stdin open a late message starts a second turn, so botdot would kill processes to keep the order of ADR 011.
- **Every message to a working bot steers.** The owner's first decision on 2026-10-20, replaced the same day by the button: a message often is the next task, not a change to this one.
- **A tool the bot calls to fetch new messages.** Read only when the bot thinks of asking, and a model that does not call it never reads one.
- **Stop and start again with both messages.** What the owner can already do; it throws away the run's work.

## Consequences

- Every run that may be steered runs a small Node process after each tool call. It answers at once when nothing was steered.
- A run waiting on one long tool call (an action in a connected app that waits for the owner's OK, a teammate's answer) reads a steered message only after that call. "Steering…" stays until then.
- A run that makes no more tool calls before its reply never reads it: the message then starts as its own run, as if it had not been steered.
- The message is part of the run that read it: Stop on that run stops it with it, and the message is not started again.
- The hook's text is context for Claude, marked as botdot's handing over of the owner's words. Claude Code shows it to the model as hook output, not as a user turn.
- Groups are not covered: a group keeps its own waiting list (ADR 019). The Chief comes under its own heading here.
