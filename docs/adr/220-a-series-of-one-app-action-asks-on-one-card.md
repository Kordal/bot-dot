# ADR-220: A series of one app action asks on one card

- **Status:** Accepted (2026-11-12, the owner's issue #1254: "One card for a series of the same app action, not one card per item")
- **Builds on:** [ADR 010](010-a-connected-app-action-waits-in-its-run.md), [ADR 056](056-what-one-run-waits-on-is-one-card.md)

## Context

A bot asked to delete four named events from Google Calendar called `connector_run` four times. Each call waited in its run for its own card, so the next card appeared only after the previous one was answered: the owner came back four times for one request. Grouping the cards of a run (ADR 056) does not help: the calls come one after another, and only one waits at a time.

## Decision

- **The bot sends the series as one call.** `connector_run` takes `items` in place of `arguments`: 2 to 50 items, each with its arguments and a label, the bot's words for the item as the owner reads it (its title and date). No two items have the same arguments.
- **One card lists every item.** Its title says the action and how many times; each item is one row, its label over all its arguments (an id among them). The rows have the limits of one action's rows: a series too long to show in full cannot be allowed once.
- **"Allow once" covers exactly those items, once each.** It is a one-use grant per item, bound to the run as one call's is (ADR 010). The call then runs every item in order and answers each item's result; one failure stops none of the others. A call outside the list, or an item again, asks on its own card.
- **Everything else is as for one call:** the wait inside the run, a decline, "Always allow" (the action with any arguments), a late yes that starts the bot again, handed the items word for word.
- **The apps draw it unchanged.** The card is the server's title and rows.

## Alternatives

- **The bot declares the series first, then calls each item.** Rejected: two tools for one thing, and a series declared and never called leaves grants nobody asked to use.
- **Group the asks of a run as they come.** Rejected: the calls are sequential, each waits for its answer, so there is never more than one card to group.
- **One yes lets the same action through for the rest of the run.** Rejected: the issue asks that one yes covers exactly the items on the card and nothing else.

## Consequences

- The tool's description tells the bot never to split such a series into separate calls; a bot that does still gets a card per call, as before.
- The bot's call of a series answers only once every item ran: a long series takes as long as its items.
