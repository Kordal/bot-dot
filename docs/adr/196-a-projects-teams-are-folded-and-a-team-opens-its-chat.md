# ADR-196: A project's teams are folded, and a team opens its chat

- **Status:** Accepted (2026-11-10, the owner's "Approved" on the mockup)
- **Changes:** ADR 132 and #838: a project's page showed every team's bots as keys, and 1-9 opened those keys

## Context

On a project's page every team showed all its bots as large keys. The owner clicked a bot expecting the team's chat and got that bot's own chat, and could not tell at a glance what was where.

## Decision

- **A team is one row, folded by default:** its faces (the lead first, with the crown), its name, and what it is at: "Needs you" when one of its bots waits for the owner, else "N working", else nothing. The whole row opens the team chat; held on Android, or ⋯ on the web, it opens the team's sheet as before.
- **The chevron before the row shows the team's bots** as keys, the lead first with the crown, and "+" to add bots. A key still opens that bot's own chat.
- **Unfolded teams are kept per project on the device:** `localStorage` key `botdot.teamsOpen` on the web, the `teams-open` preferences on Android. Nothing on the server: it is how one screen is shown, not the project.
- **1-9 open the teams' chats** in the page's order, not the bots'.
- **A bot in several teams (PR #1240)** is a key in each; on the web its key shows in how many teams it is.

## Alternatives

- **Keep the keys and make a bot's key open the team chat.** Rejected: the owner still needs a bot's own chat, and two chats behind one face is the confusion itself.
- **Fold state on the server.** Rejected: it would change for every device of the owner at once, and no bot needs it.

## Consequences

- The page shows teams first and is short; bots are one tap further.
- The browser checks unfold teams before they read keys (`unfoldTeams` in `test/helpers.js`).
