# ADR-110: A company is a place of its own, with teams that each have one lead

- **Status:** Accepted (2026-10-29); one company per account superseded by [ADR 120](120-an-account-has-several-projects-kept-as-a-list-in-one-file.md)
- **Owning task:** [#669](https://github.com/Kordal/bot-dot/issues/669), spec [#668](https://github.com/Kordal/bot-dot/issues/668)

## Context

botdot shows a person's bots as a list (or the keypad) with the Chief of Staff at the top. A person who runs a company, or starts one from an idea, wants the bots organised around it: what the company is, its 90-day goal and objectives, and who works on what. The owner approved mockups of a separate Company place: a setup with the Chief (About, Team, Start) and a home drawn as an office floor where each team is a room with one lead.

## Decision

- **A place, not a mode of the list.** A switch "Bots | Company" sits at the top of the left column of the web page and the Android app, remembered per device. Bots shows what it always showed; Company shows the company and the Chief. Nothing of the bots' list changes.
- **One company per account, kept by the server.** `data/company.json` holds one record: what the owner started from (a site or an idea), the sources, the About answers, the stories, the SWOT, the goal, what the team never does without asking, objectives, the Chief's proposed team while setting up, the teams, the owner's tasks, the week's plan and the check-ins. It is drawn by both apps from `GET /api/company` and the `company` feed event (ADR 0001); `features` has `company`.
- **Bots stay bots.** The company names bots by id in its teams. A bot is in at most one team; a team has exactly one lead, one of its bots (the first when none is named or the lead leaves); a team without bots goes. A deleted bot leaves its team. Deleting the company deletes no bot.
- **The Chief works on it by chat.** Its tools read the company and change its teams, leads and objectives' numbers (`get_company`, `set_company_team`, `set_company_objective`); its turns are told the company's goal, objectives and teams. Starting, deleting and the owner's tasks stay the owner's.
- **Everything in it is plain text.** What the owner typed and what the Chief drafts from a site are cut to length and stored as strings, drawn by the apps' own code (rule 6).

## Alternatives

- **The company as a category or group of bots.** Rejected: a category is a folder of the list and a group is one chat of two to six bots (ADR 018); neither has a lead, objectives or a setup, and stretching either would change what they mean.
- **Several companies per account now.** Deferred: the mockups and the owner's use have one. The record has an `id`, so a list can come later without changing a company's shape.
- **The company in the Chief's memory.** Rejected: memory is notes the Chief recalls, not a structure both apps draw.

## Consequences

- A new place to keep in step on the web and Android.
- The Chief's prompt grows by a few lines when a company exists.
