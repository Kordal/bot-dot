# ADR-119: A team's chat is a group that follows the team, and a message without a mention goes to its lead

- **Status:** Accepted (2026-10-29)
- **Owning task:** [#697](https://github.com/Kordal/bot-dot/issues/697), spec [#687](https://github.com/Kordal/bot-dot/issues/687)
- **Builds on:** [ADR 018](018-a-group-is-a-chat-of-its-own-and-a-turn-is-a-run-of-its-member.md), [ADR 019](019-the-botdot-server-gives-the-turns-in-a-group.md), [ADR 081](081-a-short-model-call-picks-who-answers-a-group-message-without-a-mention.md), [ADR 110](110-a-company-is-a-place-of-its-own-with-teams-that-each-have-one-lead.md), [ADR 114](114-a-team-bot-is-told-its-project-and-a-lead-what-leading-means.md)

## Context

A project's team has a lead (ADR 110) that is told it answers for the team and splits the work (ADR 114). The owner wants one chat per team, opened from the team's name, where a message that names nobody goes to the lead first and the lead brings in the members by name. A group (ADR 018) already is one chat with several bots, with turns, hand-ons by mention, Stop all, cards, files and memory.

## Decision

- **A team's chat is a group** with `team`, `lead` and `color` on its record (`groups.json`). Every team has one. It is made with the team and follows it: its name, its members (the lead first, then the team's order, any number) and its lead change with the team, and it is deleted with the team (`lib/groups.js` `syncTeams`), at every change of the project (`lib/routes/company.js`) and at the start.
- **It is the team's, not the owner's to edit as a group:** renaming it, changing its members and deleting it through the group routes is refused; the team is changed in Projects. Its place in the list is still the owner's.
- **A message that names nobody goes to the lead alone** (`lead` on the message, `to: [lead]`). The lead's turn is told it came to it as the lead, never to pass, and to answer or hand each part on by naming the member; members hand on and answer as in any group. The member whose question is open keeps its first turn (ADR 020). A mention reaches that member and `@all` every member, as in any group. A paused lead makes it any group's message.
- **The router is not asked in a team's chat** for a message that goes to the lead: the lead is the one who knows the team's split, and a model call that could pick a member would skip it.
- **Every turn in a team's chat names the lead** on a marked line, so a member knows whom the owner's message went to.

## Alternatives

- **The router with the lead preferred.** Rejected: a lead that can always be picked is the lead every time, and the call adds a second or two for nothing.
- **A chat of its own beside groups.** Rejected: it would rebuild turns, hand-ons, Stop all, cards and memory.
- **The six-member limit for a team's chat.** Rejected: a team has up to 40 bots and its chat has them all; the limit stays for groups the owner makes.

## Consequences

- An app that knows groups and not teams shows a team's chat as a group, with every member, and can write in it.
- Deleting a team erases its chat; its members' turns stay their own past runs.
- A lead that is paused leaves the team's messages to the members.
- A team bot's own runs list its team's chat among the groups it may post to (ADR 077); the prompt's bound test grows to 126,000 characters (DECISIONS.md, 2026-10-29).
