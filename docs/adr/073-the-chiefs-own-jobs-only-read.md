# ADR-073: The Chief's own jobs only read

- **Status:** Accepted (by the owner, 2026-10-23)
- **Owning task:** [#408](https://github.com/Kordal/bot-dot/issues/408)
- **Builds on:** [ADR 006](006-a-look-is-its-own-read-only-chief-session.md), [ADR 069](069-the-chief-keeps-pages-too-by-a-run-of-its-own.md), [ADR 070](070-a-look-reads-the-owners-mail-and-calendar-read-only.md)

## Context

A bot has scheduled jobs; the Chief of Staff had none. For "every morning tell me what's new on X" it made a job on a bot, which needs a bot that fits. The owner asked that the Chief have what a bot has, jobs included.

A job runs with nobody watching. A Chief turn botdot starts by itself has no connected apps and must not change botdot unasked: the Chief holds every chat, every grant and the owner's apps, so text from a page or an email must not be what drives it. Three ways were put to the owner: no Chief jobs, jobs that only read, or jobs with a turn's full rights. The owner chose jobs that only read.

## Decision

- **A Chief job** is a task in the owner's words with a schedule (`cron`, repeating) or a moment (`at`, once), at most 20, kept in `chief-jobs.json` (`lib/chief-jobs.js`).
- **Its run is a look's session** (`AS_JOB` in `lib/chief.js`): web search (no fetch of an address it picks), botdot's reading tools, and every connected app in a read-only session (ADR 070: an action that is not a plain read is refused). It has no tool that changes anything in botdot, so whatever its task or a page asks for can only be words to the owner. Only one such run (a look, a checkup, a page's run, a job) works at a time; a job that is due waits for the next round.
- **Its last words are the Chief's message**, marked `job`, in the chat the job was set up in, else the chat last used, as an unasked message is; "NOTHING" posts nothing. The owner's next turn there is told it as text the Chief wrote after reading the web (ADR 017), so what that turn changes after it is held as after the web.
- **The Chief sets jobs up by chat** (`add_my_job` and its siblings), only in a turn the owner started. The apps list them in the Chief's settings with a switch and Remove, no form (rule 5).

## Alternatives

- **A full Chief turn on a schedule.** Convenient, but a page or an email it reads could drive the Chief, which can change every bot and send in every app, with nobody watching. Rejected by the owner.
- **No Chief jobs: a bot's job always.** Safe, but not what a bot has, and the owner has to have a bot that fits.
- **Only the look's three apps (mail and calendar).** The owner set the task, and every app is read-only in the session, so every connected app is offered.

## Consequences

- "Tell me every morning" works without a bot, and its message arrives in the Chief's chat.
- A job that would need to change or send something says so in one line; the owner asks the Chief in the chat, or the Chief sets up a bot's job.
- A run waits behind a look or a page's run: a job may start a minute or two after its time.
