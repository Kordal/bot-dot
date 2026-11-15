# ADR-244: An existing bot joins a proposed team as it is

- **Status:** Accepted (2026-11-15, the owner: "During the setup of the project, it should be possible to already add the existing bots")
- **Builds on:** [ADR 128](128-create-grants-what-the-team-cards-show.md), [ADR 199](199-a-bot-may-be-in-several-teams-of-one-project.md), [ADR 239](239-new-projects-start-in-their-chiefs-conversation.md)

## Context

A project's setup proposal held only bots to be made: new ones, or copies of an existing bot ("Add existing bot", Duplicate), and the conversational setup refused copies. When the owner wanted their own "Claude Coder" in the new project's team, the Chief could not stage it: proposing it as new would make a second Claude Coder, so it offered to add it after approval instead.

## Decision

- **A proposed bot can be one of the owner's bots, as it is:** `{ existing: true, bot, name, description, team }` in `proposal` (`setup-existing-bots`). The Chief stages it with `set_company_team` as `{ existing: <id from list_bots>, team }`; the server takes the name and description from the bot, never from the Chief, and refuses an id that is not one of the account's bots.
- **Create makes nothing of it** and puts it in its team with the new bots, in the proposal's order (the first bot of a team leads). It grants nothing: the bot keeps its own tools, apps and jobs. One deleted before approval is left out.
- **The review shows it as the bot itself:** its own head, name and job, with Remove and nothing to set. The review token covers its id.
- **"Add a bot" on the review offers the account's bots** not in the proposal, to tick (the bot picker of teams), with New bot asking the Chief as before. "Change the team…" can add one by its id too.

## Alternatives

- **Add it after approval** (the Chief's workaround). Rejected: the owner reviews a team that is not the one that will work, and has to remember to ask again.
- **A copy, as Duplicate makes.** Rejected: the owner wants their bot, with its memory and history, not a second one.

## Consequences

- An older Android app draws an existing bot's card as a proposed one; it offers no picker until the server has `setup-existing-bots`.
- The iOS app shows it in the review without rename; its picker is iOS catch-up work.
