# ADR-116: A project's calendar is its events beside what the project already dates

- **Status:** Accepted (2026-10-29)
- **Owning task:** [#695](https://github.com/Kordal/bot-dot/issues/695), spec [#687](https://github.com/Kordal/bot-dot/issues/687)

## Context

The owner wants one calendar for the project (the Projects place, ADR 110), used by every bot of the project and by them: a floor tile with this week and what comes next, a month on a click. Much of what belongs on it already has a date somewhere: the check-ins of days 30, 60 and 90 (from the project's start), the to-do items with a due day and a rhythm (ADR 115), and the scheduled jobs of the project's bots. Only one-off events (a call, a launch, a deadline) have no home yet.

## Decision

- **Only events are stored.** The project record gains `events`: `{ id, title, day, time?, by, at }`, at most 300, the earliest dropped first. Everything else on the calendar is read from where it lives, at the time it is asked for, so it can never disagree with it.
- **The server lays the calendar out.** `GET /api/company/calendar` answers the items between two days (at most 62), each on its day: events, check-ins, dated to-dos (an open repeating one also on the days it will come back, from the same rule that makes its next item, ADR 115), and the next runs of the switched-on, approved jobs of the bots of the project's teams. Both apps draw the same answer: the rules of a job's schedule and a to-do's rhythm stay in one place (AGENTS.md, "decided once on the server").
- **A job is one item a day.** A job that starts many times a day is shown once, at its first time, with how many times it starts; only runs from now on are shown, since a job's past is its runs, not its schedule.
- **Who may do what.** The owner and the Chief add, move, rename and delete any event. A bot of one of the project's teams reads the calendar and adds events through its own tools (`list_project_calendar`, `add_project_event`, `set_project_event`, `remove_project_event`), and changes only the events it added, so a bot cannot move the owner's appointments. A bot in no team has none of them.
- **To-dos, check-ins and jobs are changed in their own places** (the To-do, the check-in card, a bot's jobs). The month lists them, but only events have Change and Delete there.

## Alternatives

- **Copying every dated thing into a calendar list.** Rejected: two copies of a to-do's due day or a job's schedule would drift apart.
- **Laying the calendar out in each app.** Rejected: the cron rules, the clock of the botdot machine and the to-do rhythm would be written twice, in JavaScript and Kotlin.
- **Bots changing any event.** Rejected: a bot could move or delete what the owner put there; it can still ask the Chief or the owner.

## Consequences

- The web asks for the calendar again when the project or its bots' jobs change; there is no feed event of its own.
- A bot of a team gets one more sentence in its turn (its calendar tools).
- Android draws the tile and the month from the same route in its own ticket.
