# ADR-115: A project's to-do is shared by its bots and the owner, and a repeating item comes back when it is done

- **Status:** Accepted (2026-10-29)
- **Owning task:** [#692](https://github.com/Kordal/bot-dot/issues/692), spec [#687](https://github.com/Kordal/bot-dot/issues/687)

## Context

ADR 110 gave the company (the Projects place, spec #687) a list of the owner's tasks: only the owner added, ticked and deleted them, and a task for a bot was handed to it once as a message. The owner wants one to-do for the whole project: the owner, the Chief of Staff and every bot of the project read and change it, an item is assigned to the owner or to a bot, and some items come back daily, weekly, monthly or every few days.

## Decision

- **One list in the project record.** The `todos` of the company record stay where they are; an item gains `due` (a day), `repeat`, `by` (who added it), `doneAt` and `next`. Old items read as before.
- **Who may do what.** The owner adds, assigns, dates, ticks and deletes. The Chief adds, assigns, dates and ticks through its tools (`add_project_todo`, `set_project_todo`, the routes in `CHIEF_ROUTES`), never deletes. A bot of one of the project's teams does the same through its own tools (`list_project_todos`, `add_project_todo`, `set_project_todo`) and may assign only the owner, itself or a bot of the project. A bot in no team has none of them.
- **A bot sees its own open items in its turn**, under the note of its project and team (ADR 114): its to-do tools and up to ten open items, the earliest due first, printed inert. It is told to tick an item done when it finishes it. Only the owner's item for a bot that is due (or has no day) also starts the bot, as "@Bot task" did; the Chief's and the bots' items wait for the bot's next turn, so bots adding items for each other cannot start a chain of runs.
- **A repeating item makes its next one when it is ticked.** The next is due on the first day of its rhythm after both the day it was due and today: done late, it does not come back for the days it missed; done early, it is not due twice in one period. Every N days counts from the due day; a monthly item keeps its day and falls on the last day of a shorter month. Unticking takes the next one back while it is not done. Days are calendar days of the botdot machine, counted on the UTC calendar so that no clock change moves one.
- **Bounded.** At most 200 items; over that the oldest done items go first, so a daily item never pushes out an open one.

## Alternatives

- **A to-do per team or per bot.** Rejected: the owner asked for one list with filters (All, You, Bots, Done), and a bot needs to hand work to the owner on it.
- **Repeating items as scheduled jobs.** Rejected: a job is a bot's run on a timer; a repeating to-do is a reminder that something must be done by someone, the owner included, and it only comes back once ticked.
- **Making all future occurrences up front.** Rejected: the list would fill with items nobody can act on yet, and changing the rhythm would mean rewriting them.

## Consequences

- The Chief's and the bots' prompts grow by a few lines for a bot of a team (bounded: ten items of 300 characters).
- The project calendar (#687 item 8) can draw an item by its `due` and its `repeat` without a change to the record.
- Android shows the old list until it is drawn there with the same filters.
