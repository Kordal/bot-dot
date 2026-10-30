# ADR-128: Create grants what the team cards show

- **Status:** Accepted (2026-10-30)
- **Owning task:** [#808](https://github.com/Kordal/bot-dot/issues/808)
- **Supersedes:** the part of [ADR 111](111-the-chief-proposes-a-companys-team-and-create-makes-it-once.md) that makes the bots as the Chief's `create_bot` does
- **Builds on:** [ADR 126](126-a-projects-cards-call-the-owners-own-services-with-the-projects-logins.md) (a project's logins), [ADR 127](127-the-chief-picks-a-new-projects-setup-questions-and-the-server-sends-its-screens.md) (setup that fits the ask)

## Context

A proposed bot could get apps and a short list of tools, never the account's computer, a Vault login or an SSH key, so a homelab or ops team could reach nothing it was made for. And Create made the bots as the Chief's `create_bot` does (ADR 111): each bot's tools, apps and routine waited as its own card in Needs you, right after the owner had reviewed the team on its cards. The owner wants as few approvals as possible and approved, on 30 October 2026, that Create approves what the cards show.

## Decision

- **A proposed bot says what it must reach:** `computer` (the account's computer), `logins` and `ssh` (up to four each, `{ need, id? }`). The Chief is told the names and sites of the Vault's logins and SSH keys, never a secret, and names an entry, or the host when none is saved.
- **The server matches each need to a Vault entry of its kind**, by its name, then by its host, and keeps one picked before while the Vault has it. A need without an entry is a gap; the card draws it off with one action that picks an entry (or, on the web, adds a new one in the Vault's own editor), as an app without a connection shows Connect.
- **Create is the owner's one OK.** The bots are made as the owner's own (`by: you`): the tools, apps, computer and routine on the card are granted at once, and each picked entry is shared with its bot in the Vault. Nothing waits in Needs you after Create. A share that fails (a locked Bitwarden) is logged, and the bot asks with `request_login` as any bot does.
- **The proposal is the owner's alone to change** by `PATCH`: what is on it is granted at Create, so the Chief's token is refused (`403`). The Chief still changes it only through "Change the team…", whose answer the server cuts to the shape and whose needs it matches itself.

## Alternatives

- **Keep the cards in Needs you** (ADR 111). Rejected: it asks twice for what the owner just reviewed, and the owner asked for fewer approvals.
- **Let the Chief pick the Vault entries by id.** Rejected: an id the Chief writes could name any entry; the server matches by name and host, and only the owner picks.
- **A login row per bot that always shows.** Rejected: most bots need none, and the rule is no secondary labels; the row shows only what a bot needs.

## Consequences

- Creating a team leaves no cards in Needs you; the owner's review of the cards is the approval.
- A proposal made before this keeps working: its bots have no computer, logins or SSH keys, and Create grants what their cards show.
- The project's own Logins (ADR 126) are not filled from the team's; that stays the owner's choice in project settings.
