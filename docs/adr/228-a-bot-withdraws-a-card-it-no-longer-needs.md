# ADR-228: A bot withdraws a card it no longer needs

- **Status:** Accepted (2026-11-12, the owner: "I told the bot change of plans and we will not need it, he agreed but the card is still visible")
- **Builds on:** [ADR 189](189-a-login-added-later-carries-the-run-on.md) (a login request outlives its run), [ADR 040](040-a-waiting-message-is-steered-into-the-run-at-its-next-tool-call.md) (steering)

## Context

A bot asked for a Stripe key on a login card and its run waited inside `request_login`. The owner wrote "change of plans, we won't need it"; another run of the bot agreed, but nothing could take the card back: it stayed in Needs you, the first run kept waiting ("Waiting for your OK"), and a login added later would have carried the dropped work on (ADR 189). A bot's prompt listed its waiting cards without login requests and without a way to name one, and a run blocked in a tool heard a steered message only after the tool returned, up to 14 minutes later.

## Decision

- **`withdraw_card { id }`**, a tool every bot has: the card goes from Needs you and its chat as if nobody answered, with no decline kept and nothing carried on. A run that waits for it is told it was withdrawn and goes on without it.
- **The prompt names every card with its id:** each line of "What of yours waits in Needs you" ends with `[card <id>]`, login and card payment requests included, with the rule to withdraw a card in the same reply that agrees it is no longer needed.
- **A teammate's card too:** a bot may withdraw a card of a bot whose cards its prompt lists (its teams' bots, the members of the group it answers in), so whoever the owner tells can clear it.
- **A wait for a login ends when the owner writes:** a message steered into a run that waits in `request_login` ends that wait within a second; the bot reads it and withdraws the request, or asks again to go on waiting.

## Alternatives

- **Withdraw every card of a run when it ends:** a login request outlives its run on purpose (ADR 189), and a yes on a card often carries work on (ADR 009). The bot knows when the need is gone; the end of a run does not.
- **Only the owner's Decline:** it is there, but it records a no that keeps the bot from asking again for a week, and the owner had already said it in words.

## Consequences

- A withdrawn card is no answer: a later run may ask for the same thing again.
- The apps change nothing: a withdrawn card leaves the lists as an answered one does.
