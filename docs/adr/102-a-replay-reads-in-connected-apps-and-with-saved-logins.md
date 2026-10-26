# ADR-102: A replay reads in connected apps and with saved logins

- **Status:** Accepted (2026-10-26)
- **Owning task:** [#594](https://github.com/Kordal/bot-dot/issues/594), part of [#592](https://github.com/Kordal/bot-dot/issues/592)
- **Amends:** [ADR 101](101-a-change-is-tried-on-a-bots-past-tasks-before-the-owner-sees-it.md) ("A replay has no hands")

## Context

A replay (ADR 101) runs a bot's past task again with no MCP server at all. Many tasks are about the owner's mail, calendar or an API behind a saved login: without them both sides of a replay answer from nothing, and the tally says little about the change. Giving a replay its apps back must not let it send, post, change, delete or pay anything, and must not put a card in front of the owner for a task nobody asked for.

## Decision

- **A replay has a session of its own.** botdot makes a key for each replay and forgets it when the replay ends (`lib/bots.js` `replayRun`). It is no run's key: it opens the connected apps' routes and two of the Vault's (the list of logins and `api_request`), and no other route of a bot's own tools (memory, messages, the computer, cards).
- **Connected apps run in a dry run.** The replay gets the bot's connected apps (`lib/connectors-mcp.js`, caller `replay`). An action Composio describes as only reading runs for real, as a bot's would. Any other action, and one botdot has no description of, is not made: it answers "dry run: not done" with the app, the action and the arguments it would have sent, and asks for no grant and makes no card, whatever grant the bot has (`lib/connector-approvals.js`). A replay hands an app no file. What it does leaves no row under any reply and no Reconnect card.
- **Saved logins only read.** The replay's Vault tools are `list_logins` (only the logins shared with the bot) and `api_request`, which sends a `GET` with the same rules as a run's; any other method answers "dry run: not done" with the method, the address and the body. Asking for a login, a switch or a removal is not there, and nothing writes to the Vault.
- **It is told so.** The replay's instructions say which apps read, that a write answers "dry run: not done" and that it goes on as if it had gone. The judge is told both sides had apps and logins that only read.

## Alternatives

- **Refuse a write with an error.** Rejected: the replay would try another way or stop, and its reply would be about the refusal, not the task. "Not done, with what would have been sent" lets it finish the reply it would have given.
- **Reuse a look's read-only session (ADR 070).** Rejected: a look is the Chief's, with its own apps and none of the bot's grants or logins; a replay is the bot's, and its writes answer instead of failing.
- **Give writes to a sandbox copy of the app.** Not available for Composio's apps; out of scope.

## Consequences

- A replay can read the owner's mail and call their APIs with GET, twice per task (the bot as it is, and with the change), at the admin's pace. A GET that changes something on a badly made API would change it: the same risk as a run's GET.
- The tally compares replies that had the same data, so a change that reads the right mail or API scores better.
- A copy of the bot's computer for replays is still to come (#595).
