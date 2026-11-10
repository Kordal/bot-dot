# ADR-187: A bot with a job says "Watching" on its key

- **Status:** Accepted (2026-11-10, the owner's go on "less heavy, less minding the bots")
- **Changes:** #397: a key that is not working, asking, unread, done or failed said "Idle"
- **Keeps:** every other state of a key, and their order

## Context

A bot that checks the shops every morning said "Idle" between its runs, like a bot nobody gave any work. Owners opened it to see whether it still did its job.

## Decision

- Where a key would say "Idle", a bot with a job that will run (`nextRunAt` in `GET /api/bots`) says "Watching", with when its last run was: "Watching, last 07:12" on the web page; the Android app shows "Watching" with that time beside it, as its keys show a time.
- An unseen result ("Done"), a run that didn't finish, unread replies, "Needs you" and "Working" come first, as before.
- Nothing new on the server: the apps read `nextRunAt` and the bot's newest run.

## Consequences

- A glance at the keypad tells which bots look after something, and when they last did.
