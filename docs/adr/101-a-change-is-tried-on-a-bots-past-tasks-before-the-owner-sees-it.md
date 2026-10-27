# ADR-101: A change is tried on a bot's past tasks before the owner sees it

- **Status:** Accepted (2026-10-26)
- **Owning task:** [#593](https://github.com/Kordal/bot-dot/issues/593), part of [#592](https://github.com/Kordal/bot-dot/issues/592)
- **Builds on:** [ADR 099](099-every-bot-run-has-an-outcome-in-a-ledger.md) (the outcome ledger)
- **Amended by:** [ADR 102](102-a-replay-reads-in-connected-apps-and-with-saved-logins.md): a replay reads in its connected apps and with its saved logins, in a dry run; [ADR 103](103-a-replays-commands-run-on-a-throwaway-copy-of-the-bots-computer.md): a replay runs its commands on a throwaway copy of the bot's computer

## Context

The Chief's weekly memory review (#117) proposes skills on cards, and the owner says yes or no with nothing but the skill's text to go on. Whether a skill makes a bot better can be measured: the bot's recent tasks are on record, with what the owner did after each reply (ADR 099). This project already measured its own changes by hand before shipping them (the group router's and the wake gate's benches). A replay harness makes that a part of the server, so a change is judged on the bot's own history before it reaches a card.

## Decision

- **A replay is a past task run again**, twice: the bot as it is and the bot with the change. The tasks are a bot's last 20 distinct requests from the ledger: from its own chat, its jobs and the Chief's tasks, not a group's turn, a teammate's message, a run that carries on, a follow-up, a review, an aside or a run that is left out (`lib/replay.js`).
- **A replay has no hands.** It runs as the bot, in its workspace, with Read, Grep, Glob, WebSearch, WebFetch and Skill only, and no MCP server at all: no Vault, no memory tools, no connected apps, no computer, no messages. It is told it is a replay and to say in one line what it would do with what it lacks. It is handed its main assignment, rules, pinned and shared notes, and the notes the original run's lookup found, by their ids in the ledger. It leaves no run record, no ledger row and nothing in any chat. Connected apps in dry-run (#594) and a copy of the bot's computer (#595) come later.
- **A judge picks the better reply**, on the Chief's model, without knowing which is which (their order is drawn). **The owner's signals outrank it:** for a reply the owner re-asked or corrected, their next message is what the judge measures against; a reply they took without asking again is the reference. The tally is better, worse, no difference and not tested.
- **The pace is the admin's.** "Replays an hour" on the admin page (0 to 60; 0, none, by default), handed to every account with the decision model's settings. Replays run one at a time, an hour over the pace apart. Nothing about it is shown in an account (AGENTS.md rule 5).
- **First use: the Chief's skill proposals.** Each proposal is tried on its bots' tasks before its card is added. The card's reason starts with the tally, "Better on 14 of 20 past tasks, worse on 1.", and so does its line in the review's report. A proposal worse on more tasks than better gets no card: the report names it as dropped, and it is kept with the noes so it is not proposed again. With replays off, or no past task, the card goes as before. Proposals being tried when botdot stops get their cards, untried, when it starts.

## Alternatives

- **Replay with every tool, writes refused at the last moment.** Rejected for this step: every tool would need its own dry-run, and one missed is a real email sent. Tools are added back one kind at a time, each with its dry-run (#594, #595).
- **Let the judge decide alone.** Rejected: it would optimise the judge, not the owner. The owner's own next message is the reference wherever there is one, and the owner still decides on the card.
- **Show the card at once and add the score later.** Rejected: the owner could answer before the score arrives, which is what the score is for.
- **A budget of replays in the account.** Rejected by AGENTS.md rule 5; the pace belongs to the machine.

## Consequences

- With replays on, a review's cards wait until their replays have run: 20 tasks cost 40 replays and 20 judge calls, a little over 40 minutes at 60 an hour.
- A task that needed a command, an app or a login is replayed without it: both sides lack it alike, so the tally compares the change, not the tools.
- The judge reads the bot's past requests and replies; like every replay it runs on the account's own Claude sign-in.
