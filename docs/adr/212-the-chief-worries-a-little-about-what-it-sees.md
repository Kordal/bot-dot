# ADR-212: the Chief worries a little about what it sees

- **Status:** Accepted (2026-11-11, the owner asked that the bots worry a little about the user)
- **Keeps:** [ADR 175](175-botdot-notices-between-the-looks-and-starts-one-when-it-cannot-wait.md) (the looks are the only voice that writes first, within the day's limit), [ADR 006](006-a-look-is-its-own-read-only-chief-session.md) (a look ends with one message or NOTHING)

## Context

A human assistant notices when you work every night, when your day has no gap for lunch, when tomorrow starts at six, or when too much has piled up, and offers to help. botdot's looks raised deadlines and meetings, never how the owner's days go. Done badly, care is creepy (guessing moods) or nagging (a bot asking about lunch every day).

## Decision

- **Only what botdot sees** (`lib/care.js`, no model): late nights (the owner wrote in their quiet hours two nights running; said the next morning, never at night), a full day (6 hours of meetings in the calendar, or no free 30 minutes between 11:30 and 14:30; said before 14:30), an early start (tomorrow's first meeting before 09:00; said from 16:00), too much at once (5 overdue to-dos or 5 cards in Needs you), a job that keeps failing (3 times in a row). Nothing about health, sleep, food or mood: botdot has no record of them.
- **Said as part of a look, never as one of its own:** a look, a brief or a close of the day is told at most one such item as a record, and may raise it when nothing more pressing needs the room: the fact, then one thing the Chief or a bot can do about it, at most 25 words, no advice on health or feelings, ending with answer buttons whose last is "Don't mention this". It starts no look, rings no notification of its own and is never urgent.
- **Limits:** at most one a day and two in 7 days, each kind at most once in 7 days, within the day's limit of unasked messages. An item counts as said when the look it was offered to posted a message, whether or not the message used it: the limit errs on silence.
- **Only the Chief:** the bots do not worry on their own; six bots asking about lunch is the nagging this avoids.
- **The off switch is the Chief's tool, not a control:** `writing_first` takes `care` (false: "don't worry about me") and `careQuiet` (the kinds the owner silenced with "Don't mention this"). Care starts on. `perDay: 0` silences it with the rest.
- **The calendar is read for today and tomorrow** (one read action every 5 minutes, as before, ADR 175 P7), so the day's meetings and tomorrow's first one are known.

## Alternatives

- **A model reads the owner's messages for stress.** It guesses, and a guess about someone's mood is the creepy part.
- **"We haven't seen you for a while."** A way to bring people back, not care; what waits for the owner reaches them in a look anyway.
- **A switch in Settings.** The Chief can do it by chat (AGENTS.md rule 5).

## Consequences

- care.json in the data folder keeps the mornings after a late night (7 at most) and what was said (30 days).
- The look's prompt grows by one paragraph when an item is offered.
- Real calendars and the tone of the messages are checked on a real account, not in tests.
