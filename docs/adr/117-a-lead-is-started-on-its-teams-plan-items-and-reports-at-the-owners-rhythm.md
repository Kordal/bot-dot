# ADR-117: A lead is started on its team's plan items and reports at the owner's rhythm

- **Status:** Accepted (2026-10-29)
- **Owning task:** [#696](https://github.com/Kordal/bot-dot/issues/696), spec [#687](https://github.com/Kordal/bot-dot/issues/687)

## Context

A project's week plan (ADR 110, #673) was a list of items the Chief handed out with `run_bot` after the owner's Approve. Teams had a lead (ADR 114) that knew it led, but nothing gave it its team's work or asked it to report, so the owner had to ask each team where it stood.

## Decision

- **A plan item names the team that does it** (`team`, a team's id, beside `objective`). The Chief's `set_company_plan` takes it; an id that is no team is dropped.
- **Approve starts each team's lead** with its team's items, one run per lead. The Chief is told only the items of no team, to hand out as before.
- **A lead that was not asked yet is asked how often to report**: a team made, a new lead, or a project that starts running. The team keeps `asked`, the lead that was asked, so each lead asks once; the owner's answer comes back in the lead's chat and the lead keeps it with `set_report_rhythm` (`daily`, `twice-weekly`, `weekly`). The rhythm lives on the team (`report`), and the owner changes it in the team's panel (`PUT /company/teams/:id` `{ report }`).
- **botdot starts the report** at 17:00 of the rhythm's days (Tuesday and Friday twice a week, Friday weekly), at its regular look at the project (every 15 minutes). The lead writes it with `post_team_report`; the latest is kept on the team (`lastReport`) and shown in the team's panel on the Projects screen.
- **These runs are a new trigger, `project`**: botdot's task, not the owner's words, in the lead's own chat for the owner (as a first message, `hello`, is: nothing stands above the reply). Each is queued as other work is, under one key per team, so the same work never waits twice.
- **Not a scheduled job of the bot.** A job a bot adds waits for the owner's OK on a card; the owner already answered the rhythm, and approvals are kept few (ADR 054-056).

## Alternatives

- **The Chief hands every item out, as before.** Rejected: the lead answers for its team (ADR 114); a second hand-off through the Chief only delays it.
- **The rhythm as a picker on the Projects screen only.** Rejected: the owner wants the lead to ask when it becomes lead; the picker is there to change it later.
- **The report as the run's reply, read back by botdot.** Rejected: a reply also answers the owner and may hold a question; a tool call says plainly which text is the report.

## Consequences

- A new lead writes one short question into its chat a minute after it becomes lead (after a new bot's first message).
- A team with a rhythm takes one run of its lead per report.
- An older app draws a `project` run as the owner's message; the web page and Android of this change draw nothing above it.
