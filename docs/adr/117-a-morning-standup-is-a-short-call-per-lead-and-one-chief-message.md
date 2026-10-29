# ADR-117: A morning standup is a short call per lead and one Chief message

- **Status:** Accepted (2026-10-29)
- **Owning task:** [#698](https://github.com/Kordal/bot-dot/issues/698), spec [#687](https://github.com/Kordal/bot-dot/issues/687)

## Context

A project (ADR 110) has teams, each with one lead that answers for its team (ADR 114). The owner wants each workday's start in one place: what every team got done, does next and is blocked on, without opening every lead's chat, and one message rather than one per lead.

## Decision

- **When:** each workday (Monday to Friday) at the project's `standup.time`, default 09:00, in the time zone of the quiet hours, while the project runs and has a team. It starts within three hours of its time and never inside quiet hours: a time inside them starts once they end, if that is within the three hours, else not that day. One standup per project per day. `standup.on` switches it off. Both are kept on the project (`data/company.json`); the owner and the Chief set them with `PUT /api/company/standup`, and the Chief's `set_company_standup` can also run today's at once (`now`), to try it.
- **A lead's three lines are one short call of Claude in the lead's name** (`lib/company-standup.js`, through `askClaude` as ADR 112 asks, on the Chief's model and counted as the lead's): no tools and no run. It is given what the team's bots did since the day before (each finished run: what it was asked, how it ended, the start of its reply), the week's plan and the team's open tasks, inside a block the model is told is text and never instructions. It answers JSON `{ done, next, blocked, asks }`, each a line of plain text; `asks` only when what blocks the team waits for the owner. All leads are asked at once; a failed or unusable answer leaves that team out of the day's standup.
- **The Chief merges them:** once the leads answered, the Chief gets one turn with their lines quoted, and writes the owner one short message with what waits for the owner first, as questions. No lead answered, no turn. A standup cut short by a restart is merged with what it has after 30 minutes.
- **The Projects screen draws the same lines as one card** (`standupToday`), each team in its colour: done, next and blocked; a blocked line that asks has **Reply**, which opens the lead's chat with it quoted, and counts in what waits for the owner.

## Alternatives

- **A run of each lead, posting its lines with a tool.** Rejected: a run per lead every morning, each leaving an unread reply in its chat ("one message, not one per lead"), and a lead's run that waits for an OK would hold the standup. A lead's knowledge of the team's work is in its team's runs, which the call is given.
- **botdot merges the lines into the Chief's chat by itself.** Rejected: the owner asked for the Chief's message, and the Chief can turn an ask into a question with the context of its chats.
- **A switch and a time on the Projects screen now.** Left to the project settings page ([#701](https://github.com/Kordal/bot-dot/issues/701)); until then the Chief sets them by chat (AGENTS.md rule 5).

## Consequences

- Each workday a project costs one short call per team and one Chief turn.
- A lead's own chat holds nothing of its standup; Reply quotes the blocked line, so the lead reads what it is about.
