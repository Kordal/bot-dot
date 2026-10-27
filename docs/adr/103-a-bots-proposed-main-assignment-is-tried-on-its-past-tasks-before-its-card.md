# ADR-103: A bot's proposed main assignment is tried on its past tasks before its card

- **Status:** Accepted (2026-10-27)
- **Owning task:** [#596](https://github.com/Kordal/bot-dot/issues/596), part of [#592](https://github.com/Kordal/bot-dot/issues/592)
- **Builds on:** [ADR 101](101-a-change-is-tried-on-a-bots-past-tasks-before-the-owner-sees-it.md) (the replay harness)

## Context

A bot proposes a rewrite of its own main assignment or rules with `update_instructions`, and the owner approves it on a card with nothing but the two texts to go on. ADR 101 tries the Chief's skill proposals on a bot's past tasks before their cards; a new main assignment changes every run of the bot, so it is the change most worth measuring. Once approved, the old text was kept in the bot's history, but no app showed that history, so taking a change back meant rewriting the text by hand.

## Decision

- **The card waits for its replays.** With replays on, a bot's own proposal to its main assignment or rules is replayed on its last 20 tasks, the bot as it is against the bot with the new text, before its card goes to Needs you (`lib/change-trials.js`). The bot is told its card comes once it is tried. The card's reason starts with the score ("Better on 14 of 20 past tasks, worse on 1.") and the card keeps the tally.
- **A worse score still gets its card.** Unlike a skill the Chief proposes on its own, a bot rewrites itself mostly because the owner asked it to: the score informs the owner's decision, it does not take it away.
- **A newer proposal replaces one being tried.** The older one's replays stop, and the runs that waited for it wait for the newer card. A proposal being tried when botdot stops gets its card, untried, when it starts. One whose bot is gone, or whose text the owner edited meanwhile, gets none.
- **The yes is versioned with its score.** The history entry of an approved card keeps the card's id and its tally. While nothing changed the main assignment or rules since, the bot has `undo`, and its settings show "Undo last change": one tap puts back what the card replaced, both fields of one card together.
- **The weekly report lists it.** The Chief's memory review report ends with each bot whose main assignment or rules a card changed since the last review, with the score.
- The Chief's own changes to a bot (`update_bot`) are not held: the owner asked the Chief for them in chat, and they come as before.

## Alternatives

- **Show the card at once and add the score later.** Rejected for the reason ADR 101 gives: the owner could answer before the score arrives.
- **Drop a proposal that scores worse, as a skill is dropped.** Rejected: the owner often asked for the change, and a dropped card would lose their request without a word.
- **A history screen with every past version.** Rejected for now (AGENTS.md rule 5, minimal UI): the history is in the API, and the one step back the owner needs is one tap.

## Consequences

- With replays on, a bot's proposed rewrite reaches Needs you a while later: up to 40 replays and 20 judge calls, a little over 40 minutes at 60 replays an hour, longer at a slower pace.
- An undo is a change of its own in the history, by the owner, so a second tap does not undo the undo.
