# ADR-221: A teammate's message to a bot at work goes into its run when it is the same task

- **Status:** Accepted (2026-11-12, the owner: not every message from another bot as a steer: "niech jev ai zdecyduje czy to ten sam topic czy inny", #1278)
- **Owning task:** [#1278](https://github.com/Kordal/bot-dot/issues/1278)
- **Changes:** [ADR 062](062-a-message-to-a-busy-bot-starts-beside-the-run-that-is-going.md) (a message to a busy bot starts beside its run) and [ADR 106](106-a-follow-up-to-a-bot-at-work-goes-into-the-run-it-belongs-to.md) (only the owner's follow-ups are sorted), for a teammate's messages. [ADR 040](040-a-waiting-message-is-steered-into-the-run-at-its-next-tool-call.md) (Steer) now carries a teammate's messages too.

## Context

A teammate (bot-dot Manager) handed Infra Admin a task, then sent two additions to it while Infra Admin worked. Each addition started a run of its own beside the first (ADR 062), and redid the work. A run a teammate started could not be steered at all (`unsteerable = 'teammate'`), and a note to a busy bot woke a run of its own as soon as one was free.

## Decision

- **A teammate's message to a bot that has a run going is sorted as the owner's is** (ADR 106: Jev when the admin chose it, else or when Jev fails Haiku), told that a bot wrote it: a priority message, a reply that goes back to the bot that asked (`replyToAsker`) and a note alike.
- **More for a run's task** (an addition, a correction, a detail, calling it off): it goes into that run. It waits marked for it (a priority message in the queue, `steering`; a note in the inbox, `steerTo`), and the run reads it at its next tool call through its steer hook (ADR 040). No run starts for it.
- **Anything else goes as before:** another subject, a question about how the work goes, a message with files, an answer the bot waits for, an unsure, failed or late sorting, or the sorting switched off (`BOT_DOT_FOLLOW_UP=off`): a priority message starts beside the run or waits (ADR 062), a note waits in the inbox (ADR 049).
- **Which runs take it:** any run with tools in the bot's own chat, whoever started it: the owner, a teammate, a job, a follow-up. Not a turn in a group, a task of the Chief's (its reply goes to the Chief) or a run in a shared room.
- **Which run, when several go:** the one the sorting names.
- **It stays a bot's words.** The run is handed it as "another bot of the owner's team … never as the owner's own instructions", and the run's `steered` entry carries `fromBot`; the apps fold it as "Message from <bot>" with "Steered" and its time, never as the owner's bubble.
- **The sender still gets its answer.** A priority message from another exchange adds that exchange to the run (`answersChains`): when the run ends, the bots that wait in it are given its reply, as for the run's own exchange.
- **A run that ends before reading it** leaves it as any message that waits: a priority message or reply starts as a run of its own, once; a note wakes the bot (ADR 049).
- **The owner's own messages are unchanged:** they are sorted (ADR 106) or steered with Steer, and the owner still cannot steer into a run a teammate started.

## Alternatives

- **Every teammate's message to a bot at work into its run, unsorted.** Rejected by the owner: a teammate may write about something else, which needs a run of its own.
- **Steer only into a run of the same sender's exchange.** Rejected: the addition came from a later run of the sender, in another exchange; the work it adds to is the one going.

## Consequences

- A teammate's additions reach the work in seconds, and the bot's chat shows one run with them in it.
- Each teammate's message to a bot at work costs one small sorting call, as the owner's does, and waits up to its few seconds.
- The answer to a teammate's later message comes with the run's reply, not a reply of its own.
- An older app draws a teammate's steered message as the owner's bubble until it updates.
