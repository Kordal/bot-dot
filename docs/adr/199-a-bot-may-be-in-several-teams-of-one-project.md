# ADR-199: A bot may be in several teams of one project

- **Status:** Accepted (2026-11-10, the owner: "One bot should be able to join many teams in the Project")
- **Changes:** ADR 110 and ADR 120: "a bot is in at most one team (of each project)" is dropped
- **Keeps:** a team has exactly one lead, one of its bots (ADR 110); a team without bots goes; a deleted bot leaves every team (ADR 120); each team keeps its own chat (#697)

## Context

A bot the owner relies on, such as an infrastructure admin, does work for more than one team of a project. Putting it in a second team took it out of the first, so the owner had to choose, or duplicate the bot and split its memory.

## Decision

- **Membership.** A team names its bots; a bot may be named by several teams of one project. Adding a bot to a team (`POST`/`PUT /api/company/teams`, the "+" picker, the Chief's `set_company_team`, a suggested bot joining) no longer takes it out of another. The stored shape is unchanged (`teams[].bots`), so existing projects need no migration.
- **Lead per team.** Leading stays a property of a team. A bot may lead one team and be a member of another, or lead several.
- **What a bot is told.** Its run names each team of the project it is on, with each team's lead and members, and the rules of leading and of being a member as it does each. In a turn of a team's chat it is told that team alone.
- **A lead's tools.** `set_report_rhythm` and `post_team_report` take `team` (its name or id); it is needed only by a lead of several teams, and botdot's own prompts for a team's report name the team. A lead of any team of the project may log the owner's decisions.
- **Asks drawn under a lead** (ADR 148): a bot that leads any of the project's teams is drawn as itself; a member of several teams under the lead of its first.

## Alternatives

- **Copy the bot per team.** Rejected: two bots with split memory and doubled jobs for one piece of work.
- **A lead role per bot instead of per team.** Rejected: a bot can lead one team and help another.

## Consequences

- The project floor draws such a bot in each team's room; Home still shows each bot once.
- An older app shows the same data; its "+" picker still says "In <team>" for a bot of another team, which is now true after adding it too.
