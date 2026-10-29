# ADR-111: The Chief proposes a company's team, and Create makes it once

- **Status:** Accepted (2026-10-29)
- **Owning task:** [#671](https://github.com/Kordal/bot-dot/issues/671), spec [#668](https://github.com/Kordal/bot-dot/issues/668)

## Context

After the About step (ADR 110) the owner gets a proposed team of bots, edits it on cards or by asking the Chief in "Change the team…", may add copies of bots they already have, and presses "Create N bots". The proposal must be drawn the same on the web and Android, survive a reload, and be made into real bots without making a bot twice.

## Decision

- **The proposal lives in the company record**, not in the page: `proposal` (the cards), `teamChat` (the last lines of "Change the team…") and the last ten proposals before each change, for Undo. Every change of the proposal, the Chief's or the owner's own `PATCH`, can be undone; the Chief's line that made the last change carries the Undo.
- **The Chief is one question with no tools** (lib/dresser.js `askClaude` with a system prompt of its own, as lib/group-router.js asks), on Sonnet by default (`BOT_DOT_COMPANY_MODEL`). It answers JSON; lib/company.js keeps only the known fields, cut to length, its tools to a short safe list and its schedule to a cron. Copies name only bots that exist, and the Chief can never mark a proposed bot as made.
- **Create makes the bots as the Chief's `create_bot` does** (`by: chief`): the tools, apps and routine a proposed bot was given wait for the owner's OK in Needs you, as they would had the Chief made it in chat. "Asks first" becomes a line of the bot's rules. A copy is made as Duplicate makes one (#227), by the owner, without sharing Vault entries: the owner shares those in the Vault.
- **Create is idempotent.** Each made bot's id is written into its proposed card at once; a second Create answers the company as it is, and one cut short makes only the bots still missing. Then one team per proposed team name, its first bot the lead, the first test as plan item 1, and the company running.

## Alternatives

- **The Chief's own chat turn with its tools** (create_bot, set_company_team). Rejected: a full turn is slow, writes into the Chief's chat, and would make the bots before the owner pressed Create.
- **The proposal kept by each app.** Rejected: two apps would decide it twice (ADR 0001) and a reload would lose it.
- **Bots made by the owner (`by: you`).** Rejected: the owner reviewed names and jobs on cards, not the tools and apps each bot gets; those still wait for an OK.

## Consequences

- Creating a team of N bots can leave up to N cards in Needs you.
- A copy does not get the original's Vault entries until the owner shares them.
