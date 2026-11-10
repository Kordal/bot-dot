# ADR-189: A login added later carries the run on

- **Status:** Accepted (2026-11-10, the owner's "Tak" on B, #1117)
- **Changes:** docs/product/milestone6.md (a login stays out of carry-on): a bot's login request now carries its run on
- **Keeps:** ADR 009 for asks; a card request (paying) and the Chief's login requests end with their run as before

## Context

A run that asked for a login waited about 14 minutes and ended with "I need the login". Its request was withdrawn, and a login added later started nothing: the owner had to remember what the bot was doing and ask again. A login is the most common thing a new bot waits for.

## Decision

- **The request stays.** When the run that asked gives up or ends, a bot's login request stays in Needs you for 7 days (`ranOut`). No run waits for it meanwhile.
- **Added, the work carries on.** Saved or allowed in that time, the run's work carries on by the rules a late yes on a card carries it on by (`whatCarriesOn`, `carryOn`), told which login it has now.
- **Asked again, it is one request.** A later run of the bot that asks for the same site takes the request over and waits for it as before.
- **In memory, as every login request:** a restart forgets it, and the bot asks again when it next needs it.

## Alternatives

- **Keep the request on disk.** Not now: requests live in memory with the card requests that share their store. A restart losing a week-old request costs one more ask.

## Consequences

- "Add the login when you can" works: the bot goes on by itself once it is there.
- A bot can show Needs you for up to a week for a login it asked for.
