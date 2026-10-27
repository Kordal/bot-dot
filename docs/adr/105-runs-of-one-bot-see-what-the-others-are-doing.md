# ADR-105: Runs of one bot see what the others are doing

- **Status:** Accepted (2026-10-27)
- **Owning task:** [#609](https://github.com/Kordal/bot-dot/issues/609)
- **Amends:** [ADR 062](062-a-message-to-a-busy-bot-starts-beside-the-run-that-is-going.md), [ADR 040](040-a-waiting-message-is-steered-into-the-run-at-its-next-tool-call.md)

## Context

ADR 062 lets up to three runs of one bot go at once. A run that started beside others was told what each was asked, once, and that it could not see them; a run that was going first was never told of a later one. What a run asked is often not what it does: on a live account a run asked only a 2FA code was sorting the inbox by the triage rules (its plan said so), while a second run of the same bot told the owner the triage had not run yet and offered to start it.

The bot's prompt is at its size cap, so a live picture of every other run can't be added to every prompt.

## Decision

- **At its start** a run beside others is told, for each, what it was asked and, where the run says, its working line and its plan (at most eight steps, one line each). Nothing more goes into the prompt.
- **At its next tool call** a run hears of each run of its bot that started after it, once, through the after-tool hook (ADR 040). Every run that calls tools now gets that hook, not only the runs the owner may steer: a run the Chief or a teammate started goes beside others too. Steering itself is unchanged: only a steerable run is handed a steered message.
- **On demand**, a bot's tool `other_runs` answers what each other run going now was asked and by whom, its working line, its plan and its reply as written so far, in the shape `/btw` reads them (`lib/btw.js runBlock`). It reads what botdot holds in memory, no file and no broker call.
- **What a run is asked to do** with this: keep to its own task, leave to the others what they were asked, call `other_runs` before it changes what they may be changing and before it says something is or is not done.

## Alternatives

- **A live digest of the others in every hook answer.** Rejected: it repeats at every tool call and grows each run's context for little.
- **A lock per shared thing (a mailbox, a folder).** Not now: botdot does not know what a run will touch. Runs are told; a lock is follow-up work if that is not enough.
- **Back to one run at a time.** Rejected: ADR 062's reason (a long run blocking a teammate and the owner) still holds.

## Consequences

- A run that was asked nothing about a thing but is doing it is still seen through its plan and working line; a run that keeps no plan is seen only by what it was asked and its line.
- Each tool call of a run the owner can't steer now makes one local HTTP call to botdot, as a steerable run's already did.
