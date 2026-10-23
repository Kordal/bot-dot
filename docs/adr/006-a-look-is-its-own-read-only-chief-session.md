# ADR-006: A look is its own read-only Chief session

- **Status:** Accepted
- **Owning task:** CHF-001
- **Changed by:** CHF-006 (no `WebFetch`; the record of unasked messages; what counts as "nothing"); [ADR 070](070-a-look-reads-the-owners-mail-and-calendar-read-only.md) (a look reads the owner's mail and calendar, read-only)

## Context

[Milestone 3](../product/milestone3.md) has the Chief of Staff write first: a few times a day botdot starts a Chief turn nobody asked for (a "look"), which ends with one message or with nothing. Today a Chief turn starts only from the owner's message, runs in the chat's own Claude session (`--resume`), and may use every tool the Chief has, including the ones that create, change and run bots (`lib/chief.js`). The Chief has no web search.

A look differs from such a turn in three ways. Its content includes fresh finds from the web, so it reads search results nobody vetted. Nobody is watching when it runs. And most looks end with nothing, which must leave no trace in the chat or in the chat's session.

The stage 4 trial ([milestone3-research.md](../archive/product/milestone3-research.md)) showed that one prompt with the owner's recent chats, the bots and the topics already raised is enough for a model to pick a relevant message or answer "nothing".

## Decision

- **Its own session.** A look runs as a new Claude session, never resuming a chat's session, and the session is not kept (`--no-session-persistence`).
- **Read-only tools plus web search.** A look gets `WebSearch` and botdot's reading tools: `recall`, `list_bots`, `get_bot`, `list_runs` and `get_run`. It gets no tool that creates, changes, runs or deletes anything, sends a message to a bot, or writes memory, and no tool that fetches a URL of its choosing. The list is held three times over, so that one slip does not open it:
  - `--tools WebSearch` leaves a look no other built-in tool (no files, no commands, no skills, no fetch), and `--allowedTools` names the six;
  - the Chief's tools server, started with `BOT_DOT_LOOK=1`, offers a look the five reading tools and refuses every other name;
  - `get_run` in a look leaves out the mark "the Chief saw how this run ended", which is the one thing a reading tool wrote. Every request a look's tools make to the botdot server is a `GET`; a test calls each tool and fails on anything else.
- **What a look can leak, and what not.** A look's prompt holds the owner's data: the shared memory, recent Chief chats, the bots. Search results it reads can tell it to do something. Up to CHF-006 a look also had `WebFetch`, which can request any URL: a result could have it fetch an attacker's address with that data in the query, or reach the owner's own network. CHF-006 removed it, and a test fails when it comes back. What remains: the words of a search query go to the search provider, so a result can still lead a look to put some of the owner's data into a query, which reaches the search provider behind Claude's web search, not an address of the attacker's choosing; and a result can change the words of the one message the owner reads. A fresh find now rests on search results alone.
- **The input is a digest in the prompt, with `recall` for more.** The server puts together what a look reads before it decides: the owner's date and time, the shared memory, the bots with their descriptions, the eight most recent Chief chats (thirty messages each, clipped), and the unasked messages of the last sixty days, newest first, with their rating and the owner's answer, which are also the topics already raised.
- **The look keeps a record of what it posted** (CHF-006; until then it read its earlier messages from the chats that still existed). Every unasked message botdot posts is kept with the look's state in `looks.json`: its id, chat, time, text, rating and the owner's answer. The message carries the id (`lookId`); a rating and the owner's next message in that chat change the record too. Deleting the chat leaves it there, so a topic is not raised again and its rating is not lost; a backup carries it. On start, an unasked message that is not in the record yet (one posted before it, or a chat put back by hand) joins it with what its chat says. Bots' runs are not in the digest: a look reads them with `list_runs`, `get_run` and `recall` when a chat points at one. The owner's own rules for the Chief are added to the look's instructions.
- **The Chief's model.** A look runs on the model and reasoning level the owner set for the Chief, because it is the Chief who writes. No separate setting.
- **Four times a day, spread over the hours outside quiet hours.** The waking day is cut into four equal parts and a look starts in the middle of each: with quiet hours from 22:00 to 07:00, at 08:53, 12:38, 16:23 and 20:08 in the owner's time zone. Four is one more than the most messages a day, so that one look that ends with nothing does not cost the day a message, and three messages still spread from morning to evening. The times move with the quiet hours. A look starts within fifteen minutes of its time or not at all.
- **The server posts the message.** The look's final text is the message. An answer whose first word is `NOTHING` (any case, however dressed, whatever follows it), one that only says there is nothing new (as a scheduled report's "no news" is recognised), and an empty or failed turn post nothing (until CHF-006 only a bare `NOTHING` did, and "NOTHING. Nothing new since the last look." was posted). The server appends the message to the Chief chat the owner last used, as a `chief` message with `unasked: true`, and announces it like a reply, so [ADR 005](005-read-positions-on-the-server.md) counts it as new without change. The server remembers that chat by its id (`chief-last-chat.json`): when it was deleted, the message starts a new chat rather than landing in an older one.
- **The chat's session learns of it on the owner's next turn,** the way it learns of a reminder that went off: the message is quoted in the prompt once (`seen`), with a line saying that botdot wrote it in a look and that `writing_first` changes how often. The line was added (CHF-006) because a chat's session that started before the Chief wrote first kept the instructions it started with, which do not mention looks or `writing_first`. Since CHF-007 a resumed session is given the current instructions on its next turn after they change; the line stays, so the turn that answers an unasked message says what it was and how to change how often.
- **The server keeps the limits,** not the model: at most N a day (default three, the owner's setting through the Chief's `writing_first` tool, 0 for off), none in quiet hours, none while a Chief turn is running, none in the first hour after a start, no catch-up for missed times. A look that may not start is skipped, not put off. The count is of messages posted, by the owner's day in the time zone of their quiet hours, and lives with the last look's time in `looks.json` in the data folder; the setting is `unaskedPerDay` in `settings.json`. The limit is a loop guard on unasked messages, not a spending cap.
- **Ratings sit on the message.** `rating: "up" | "down"` or absent, set by `PUT /api/chief/chats/:chatId/messages/:index/rating`, announced on the live feed, listed in `features` as `ratings`.
- **A look by hand, for test environments.** With `BOT_DOT_LOOK_ON_DEMAND=1` the owner can start a look with `POST /api/chief/look`; its time and the first hour do not apply, every other limit does. Without the variable the route does not exist.

## Alternatives

- **A look as a turn in the chat's session.** The Chief would know the chat already. Rejected: every "nothing" would add a hidden exchange to the session, and the turn would hold the Chief's changing tools while reading the web unwatched.
- **Leave the input to `recall`.** The look would search for what it needs. Rejected: the stage 4 trial got its results from a digest in one model turn, and a look that must search before it knows the owner is slower and misses what it did not think to ask.
- **A cheaper model for looks.** Rejected: the message is in the Chief's voice, the owner wants no spending caps, and four looks a day are few.
- **Looks at fixed clock times, or one per allowed message.** Fixed times ignore the owner's quiet hours; three looks for three messages lose a message to every "nothing".
- **Only the allowed-tools list as the guard.** Rejected: one wrong entry would hand an unwatched session a changing tool. The tools server refuses them as well.
- **Hand the web part to a bot.** Keeps the Chief without web tools. Rejected for now: it adds a bot the owner did not make and a hand-off for every look.
- **A scheduled job of an ordinary bot.** Works today. Rejected: the owner asked for the Chief to write, in the Chief's chat, from what the Chief knows.

## Consequences

- The Chief gains a second way of running, with its own prompt and tool list to keep in step with the first.
- A look cannot act; "want me to change its check?" needs the owner's answer, which starts an ordinary turn.
- Note, 2026-10-22 (#341): a look may end its message with one `[[choices: …]]` line, as a reply can. botdot takes the line off and the message carries answer buttons; a tap is that ordinary turn.
- Note, 2026-10-23 (#416): the owner may name up to four look times by chat (`writing_first` `times`), in place of the even spread; the first of their day is then a brief in four fixed parts. Once a week a look offers one bot or job for something the owner did 3+ times, and once, after mail or a calendar is first connected, a look reads 30 days of it. They are looks like the others: the same read-only session, the same daily cap, and the owner's yes starts an ordinary turn.
- An app from before this change shows an unasked message as a plain reply.
- A tool added to the Chief is not a look's unless it is added to the reading list, and the test then calls it.
- Unasked messages outlive their chat in the look's record; the record grows by at most three a day, and a look reads sixty days of it.
- Without a fetch tool a look cannot read a page a search found, only the search results; fresh finds may be rarer.
- The look's prompt and the number of looks a day are constants in `lib/look.js`, tuned on real use in CHF-005.
