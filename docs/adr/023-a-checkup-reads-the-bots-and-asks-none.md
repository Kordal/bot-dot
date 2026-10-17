# ADR-023: A checkup is its own read-only Chief session that reads the bots and asks none

- **Status:** Accepted (2026-10-12, the choices below are the owner's)
- **Owning task:** [#387](https://github.com/Kordal/bot-dot/issues/387)

## Context

The owner ran a bot called Fleet Doctor on their botdot server from 25 September to 12 October 2026. On weekday mornings it messaged every bot with a questionnaire (friction in the chats the owner started, jobs, gaps), each bot ran to read its own chats and jobs and answered, and Fleet Doctor wrote a report with up to seven proposals. A pick went to the Chief of Staff with `send_to_chief` and waited there for the owner a second time.

What its runs on that server show:

- **It asked because it could not read.** A bot reads only its own runs. Over thirteen checkup days Fleet Doctor started 175 runs in other bots (1,043 turns) to have them describe themselves. The Chief's reading tools (`list_bots`, `get_bot`, `list_runs`, `get_run`) already read all of it.
- **A bot's account of itself is unreliable.** Its skill says "a bot judges itself mildly". Bots answered in their own chat instead of by message, and one reported "list_jobs shows none" for a job that had run the day before.
- **Most proposals went unused.** Of about eleven reports the owner answered five: "All" twice, one proposal once, none twice. The seven proposals of 8 October were all dropped.
- **A pick was approved twice,** once with Fleet Doctor and again in the Chief's chats.
- **Its timing was a workaround.** A second job an hour later read a marker file to learn whether the report had gone out, and by 12 October the bot sent two messages a morning.
- **It could not see** the Board, a failed scheduled run or the server.

[ADR 006](006-a-look-is-its-own-read-only-chief-session.md) already has the botdot server start a Chief turn nobody asked for, in a session of its own that only reads.

## Decision

- **A checkup is a Chief turn the botdot server starts,** on the days of the week and at the one time the owner set through the Chief, at most once a day. Weekdays at 08:00 in the time zone of the quiet hours is how it starts. A time inside quiet hours is refused.
- **It reads and asks no bot.** The server puts together what happened since the last checkup that ran, at most seven days back: the chats the owner started with bots, in groups and with the Chief, failed and stopped runs including scheduled ones, each job's state and how often it found nothing, messages between bots left unread, and the Board's tiles. A chat that is left out ([ADR 016](016-a-forgotten-note-is-erased-and-a-removed-one-ends.md)) is not in it. No bot is messaged and no bot runs.
- **Its own session, read-only,** as a look's is: a new Claude session that is not kept, with botdot's reading tools and nothing that creates, changes, runs, deletes, messages or writes memory. The list is held the way ADR 006 holds a look's.
- **Web search is a setting, off until the owner turns it on,** and it is search only: no tool that opens an address the session picks. A checkup's prompt holds the owner's chats with every bot, and a search result is text nobody vetted. The Chief may change the checkup's setting only in a turn the owner started by writing to it, and may switch web search on only before that turn read anything that is not the owner's: a bot's reply or a page must not be what opens the web. Otherwise the owner uses the switch.
- **It is not a look.** Its message is not an unasked message: it is not rated and does not count toward the three a day. It has its own switch, on by default.
- **It ends with at most three proposals or with nothing.** Each proposal is a rule, a skill, a bot, a job or a tile, with the day and the words that show why. Nothing to propose posts nothing and opens no chat.
- **Its answer is data, and the server writes the message.** A checkup answers `NOTHING` or a list of proposals as JSON. The server keeps at most three that hold up (a kind it knows, a bot that exists, a change, evidence with its day) and writes the chat message from them, so nothing a checkup writes reaches the chat as markup of its own, and the record holds each proposal as fields, not as prose to parse later.
- **The message opens a new Chief chat,** named for the day, with answer buttons ("Do 1", "Do all", "Not now"). The owner can also type which ones.
- **A pick is the yes.** The Chief makes the change in that chat, in an ordinary turn with its ordinary tools. What needs a card anyway (a script, an installed tool, a login) still asks.
- **The server keeps a record of proposals:** picked ones are not proposed again, a declined one comes back only with new evidence, and an unanswered one may appear once more and is then dropped. A checkup is told the record and names the earlier proposal it makes again; the server then applies the rule to it, with "new evidence" meaning evidence of a later day than the decline. One it does not name is still known when its kind, its bot and its words are the same; one worded anew is not, and that part rests on its instructions.
- **A plain pick is read by the server.** The owner's first message after a chat's proposals is kept as their answer when it plainly is one ("Do 1", "Do 1 and 3", "Do all", "Not now"); a proposal that was shown and passed over counts as declined. Anything else is left to the Chief, which says what it did with its `checkup` tool.
- **A checkup that cannot start on time** (a Chief turn is running, a look is at work, the server was restarting) starts when the Chief is free, up to two hours late, past midnight too. A run belongs to the checkup in whose window it ended, so one still going is read by the next. After that the day is skipped and the next checkup's window covers it. A look and a checkup are never at work together.
- **On demand:** the owner can ask for a checkup in any Chief chat, with the switch off too. The Chief gets the same facts through a tool and answers in that chat; it does not replace the day's scheduled checkup, and it has no web search, because a Chief reply has none.
- **The switches are in the Chief's settings in all three apps:** "Checkup" with a line that says when it runs, and "Web search" below it, greyed out while the checkup is off. The Chief changes both, and the schedule, by chat. The server announces `checkup` in `features`.

## Alternatives

- **Keep it a bot that asks the others.** Refused: the 175 runs, the mild self-reports and the second approval above.
- **Give a bot the right to read other bots' runs.** Refused: every bot's chats would be open to a session that also runs commands and writes files. The Chief's read-only session already has the right and nothing else.
- **Make it a kind of look** that counts toward the three unasked messages a day and is rated. Refused by the owner: a checkup is asked for by its schedule, and a rating says nothing a pick does not.
- **Up to seven proposals with status bullets,** as Fleet Doctor wrote. Refused: the owner picked few of them.
- **No switch, chat only,** as rule 5 of `AGENTS.md` would have it. Refused by the owner, who asked for the switch ([DECISIONS.md](../DECISIONS.md), 2026-10-12).
- **Web search always on,** as in a look. Refused: a checkup's prompt holds far more of the owner's chats than a look's digest does.

## Consequences

- The botdot server starts two kinds of Chief turn by itself, a look and a checkup, each with its own limits, record and switch.
- A checkup sees what the server recorded, not what a bot thinks of itself: a preference a bot could have found, which only that bot could name, is found only when the owner's words in the chat show it.
- The owner's Fleet Doctor bot is not touched by this. It is the owner's to delete, and what it remembered about declined proposals is not carried over.
- Web search in an ordinary Chief reply is a separate decision.
- `docs/api.md` gets the checkup's settings, its chat and the `checkup` feature in the task that builds them.
