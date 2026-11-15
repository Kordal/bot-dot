# ADR-249: Reminders need no card

- **Status:** Accepted
- **Owning task:** the owner's request of 15 November 2026 ("no need to ask for the approval for reminders")
- **Changes:** [ADR 033](033-the-chief-reads-the-web-and-what-it-changes-after-waits.md) (a reminder waited after the web), [ADR 055](055-always-allow-on-more-cards.md) ("Always allow reminders"), [ADR 247](247-a-projects-own-changes-after-the-web-need-no-card.md) (a reminder's deletion waited)

## Context

A bot's own reminders never had a card (#343). Outside a room run, that is: in a run the owner started in a shared room every tool waited on a `room-tool` card. The Chief's did, in a chat that had read the web: `remind_me` and `cancel_reminder` waited on a `chief-action` card, and "Always allow reminders" took one card first. The owner taps Approve on those cards because they are there. A reminder is a ⏰ message in the owner's own chat at a time: it changes nothing else, reaches nothing outside the account, and the owner sees it when it goes off.

## Decision

- **The Chief's reminders are free after the web.** `POST /api/chief/reminders` and `DELETE /api/chief/reminders/:id` are in `FREE_AFTER_WEB` (`server.js`): set and cancelled at once, in any chat.
- **A bot's own reminders in a room run go on too.** `remind_me`, `list_reminders` and `cancel_reminder` skip the `room-tool` card (`lib/room-runs.js`): the reminder goes off in the bot's own chat with the owner, never in the room.
- **"Always allow reminders" is gone.** `reminders` leaves `AFTER_WEB_TYPES` (`lib/asks.js`). A grant of it saved before is ignored where grants are listed and read.
- The Chief's prompt says reminders never wait, and to set only the one the user asked for.

## Alternatives

- **Free setting, hold cancelling** (as ADR 247 holds deletions): a cancelled reminder is one the owner may miss, but a card to cancel what the owner asked to cancel is the same complaint.

## Consequences

- A page that persuades the Chief can set or cancel a reminder. A set one is a message in the owner's chat; a check reminder (`check: true`) starts a look, which only reads.
