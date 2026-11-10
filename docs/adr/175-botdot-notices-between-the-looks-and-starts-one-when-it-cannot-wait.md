# ADR-175: botdot notices between the looks, and starts one when it cannot wait

- **Status:** Accepted (2026-11-10, the owner asked for a proactivity system that feels like a human assistant)
- **Changes:** [ADR 006](006-a-look-is-its-own-read-only-chief-session.md) (a look starts at the clock's times and also when botdot noticed something; the first look of the day is the brief and the last closes the day without named times; up to 8 messages a day by default, 10 at most, over 9 looks)
- **Keeps:** [ADR 006](006-a-look-is-its-own-read-only-chief-session.md) (a look only reads and ends with one message or NOTHING), [ADR 082](082-the-admin-chooses-haiku-or-jev-to-pick-who-answers-in-a-group.md) (Jev is the admin's choice, its key held in memory alone)

## Context

Every proactive message came from the clock: four looks a day at fixed times, the brief only when the owner named times. A meeting in 40 minutes, a card waiting since yesterday or an overdue to-do reached the owner at the next slot, or not at all. A human assistant reacts to what happens and picks the moment.

## Decision

- **Signals without a model** (`lib/attention.js`): every minute the server reads what it holds and makes records with a weight: a project event with a time that starts within 120 minutes (weight 3 within 60), a to-do overdue (2) or due today (1), a card in Needs you that has waited 12 hours (2).
- **The agenda** (`agenda.json`): each signal while it is open, when it was first seen, whether it woke a look or was asked about. A signal that is gone (the to-do ticked, the card answered) is closed and forgotten after 14 days.
- **A look between the clock's looks:** a weight-3 item starts one, once. A weight-2 item is put once to Jev, when the admin chose Jev: "does the owner need it before the next look at HH:MM?"; at 0.7 or more it starts one. Without Jev nothing is asked and it waits for the next look: no Claude call is spent on the question.
- **The rules of a look stay, with two changes:** it never starts in quiet hours, in the first hour, while the Chief works, or while the owner wrote in the last 10 minutes (focus; it is tried again a minute later). It may post one message over the day's limit, once a day.
- **The look is told why it starts** and the cards that wait, as records, and raises it first unless "Already raised" holds it. Its record keeps the kind of item that started it, for learning later.
- **The day's rhythm:** without named times the first look of the day is the brief, and of two or more looks the last closes the day (what the bots finished, what is left for tomorrow, one decision; NOTHING when nothing happened). A hand-off that is due takes the close's place.
- **More room:** 8 unasked messages a day by default, up to 10 when the owner asks, over 9 looks spread over the waking day (one more than the messages).

## Later parts

- **Learning per kind (P6):** of the last 30 days, a kind of noticed item (event, to-do, card) that started 10 looks or more and was rated up or answered in fewer than 1 in 5 starts no more looks. Its looks age out after 30 days and it starts again. Each unasked message's record keeps `noticed`, the kind that started it.
- **Follow-through (P3):** the Chief's `remind_me` takes `check: true` for what it promised to check, what the owner waits for from someone, and the owner's "later". At its time a check is a weight-3 item, never quiet: it starts a look that looks whether it happened and says what it found, and the check is removed. One that could start no look within 6 hours (writing first off, quiet hours) goes off as a ⏰ line after all.
- **Bots that write first share the budget (P5):** a bot's watch (a scheduled job with notify "report-only") that reports with `notify_owner` counts against the same day's budget as the Chief's unasked messages. Past it, the report is delivered all the same, unread in its bot's chat, but quietly: its `run_finished` has no `new`, so nothing rings. An urgent report, a reply that asks the owner something, a Reconnect card, a one-time job and a job whose every run the owner asked to hear from (notify "always") are outside the budget. The brief and the close of the day count only the Chief's own messages, so the bots never crowd them out. A budget of 0 silences the Chief, not the bots.
- **Mail and calendar as signals (P7):** with Gmail or Google Calendar connected, the server reads them itself every 5 minutes outside quiet hours, without a model, with two read actions (`GMAIL_FETCH_EMAILS` for unread primary mail of the last day, `GOOGLECALENDAR_EVENTS_LIST` for the next two hours). A new mail is a weight-2 item (`mail`), put to Jev once; a meeting is weight 3 from an hour before (`calendar`). A mail that is read leaves the agenda. Both kinds learn as the others do.
- **Urgency in delivery (P4):** an unasked message from a look a weight-3 item started is announced with `urgent: true`, and its notification goes out with high priority. Every other unasked message rings as a reply does.

## Alternatives

- **Ask Haiku about each weight-2 item without Jev.** A Claude call per item and minute adds up; the next look comes within about 100 minutes anyway.
- **Push a notification straight from the detector.** It would speak without the Chief's judgment and without "Already raised"; the look stays the only voice.
- **Composio triggers for new mail.** A trigger delivers to a webhook, which a server at home (BOT_DOT_REACH=local) does not have, and needs a trigger set up per connection in the owner's own Composio project. Composio's Gmail trigger polls too; reading every 5 minutes is as soon, and works on every server.

## Consequences

- An owner who set 3 a day keeps 3; one who never set it gets 8.
- The look's prompt grows by at most 12 lines of agenda.
- With Gmail and Google Calendar connected, up to 2 Composio read actions every 5 minutes outside quiet hours (about 360 a day). Outlook is not read yet: its looks still read it at their times (ADR 070).
