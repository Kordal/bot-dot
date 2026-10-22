# ADR-064: A check a bot offers runs on the owner's yes

- **Status:** Accepted (by the owner, 2026-10-22)
- **Owning task:** [#342](https://github.com/Kordal/bot-dot/issues/342)
- **Changes:** who approves a job a bot sets up for itself (until now: always the owner, on a card)

## Context

A bot offers to look again later ("I'll check at 13:20 whether the boarding pass came, and only write if it didn't") and ends its reply with a choice. The owner taps "Yes", which starts a run with their own message, and the bot sets up a one-time AI job. That job then waited on its own card in Needs you: two taps for one decision. The owner asked for fewer approvals.

## Decision

- **A check a bot offers is approved at once.** A job a bot sets up is approved without a card when all of these hold: it is an AI job (`kind: "ai"`, no script), it runs once (`at`), it is due within 7 days, it has no call and no notify address, it is new or was never approved, and the run that sets it up was started by the owner's own message (`runStanding(runId).startedBy === "owner"`, the same test memory uses).
- **The server decides it**, in `lib/jobs.js` (`autoApproved`, `offeredCheck`), from the run's standing, not from anything the bot says.
- **Everything else still waits:** recurring jobs, script jobs, calls, notify addresses, a job further ahead than 7 days, a change to an approved job, and any job set up in a run started by a job, a teammate, the Chief, a call or botdot.
- The job runs with the tools the bot already has; an action that writes in a connected app still asks on its card.

## Alternatives

- **Approve it from the prompt** ("the owner said yes"): a bot's word is not the owner's; the run's trigger is.
- **Approve any AI job a bot sets up in the owner's run**: a recurring job keeps running long after the owner forgot the yes. One check, within a week, ends by itself.
- **Mark the choice that was tapped as "approves a job"**: needs a new kind of choice in both apps for the same outcome.

## Consequences

- Outside content read in the same run (an email, a page) could steer the bot into setting up such a check. It is bounded: one run, the bot's own powers, within a week, shown in its jobs list, and removed after it runs.
- The bot's `add_job` answer no longer says the job waits, so it tells the owner when it will check.
- Apps need no change: the job arrives with `approved: true`, as one the owner made.
