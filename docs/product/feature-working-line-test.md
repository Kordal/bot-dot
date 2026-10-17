# Feature test: the working line follows a bot's work

Test document of ALV-002 ([Kordal/bot-dot#331](https://github.com/Kordal/bot-dot/issues/331), from the spec [Kordal/bot-dot#329](https://github.com/Kordal/bot-dot/issues/329)): a working bot's one line goes on after its opening line, in the botdot server's words, under the bot's chat and in its row on the web page. The Android app follows in ALV-003 ([Kordal/bot-dot#332](https://github.com/Kordal/bot-dot/issues/332)): its steps are under Android below. Groups and the Chief of Staff follow in ALV-004 ([Kordal/bot-dot#333](https://github.com/Kordal/bot-dot/issues/333)): their steps are under Groups and the Chief of Staff below.

## Checked before the owner's test

- `make lint` and `make test` passed on the working tree of this ticket.
- `test/working-line.test.js`: the real botdot server with the stand-in Claude. The line reads the opening line first and then the server's words for each step, on the feed, on the running run and in the run's stream; "Starting its computer" while a computer starts; two steps within a second give one change with the last words; the line is gone on the reply and on Stop; no secret, command, long address or path is in it; the run's log has no new events.
- `test/working-line-web.test.js`: the web page's own functions against stand-in elements. The page draws the server's text under the chat and in the row, follows it from the feed and from the run's stream, and shows the opening line as before against a server without the feature.
- ALV-004, `test/one-set-of-words.test.js`: the real botdot server with the stand-in Claude. In a group two members work one after another and each one's line reads the server's words for its steps, on the feed, in the group's `working`, on the turn's run and in its stream; two steps within a second give one change; the line is gone on the reply and on "Stop all"; the opening line is sent as before. Every tool of the Chief has words.
- Review fixes, `test/chief-line.test.js`: the real botdot server with the stand-in Claude. The Chief's `activity` reads a bot's words for a tool a bot can also use and its own for its own tools; its `text` is the whole line, the opening line first, kept while the step it announced runs, then the steps that follow; four changes within a second give one, with the last words; Stop clears it at once and nothing comes after. `test/line-events.test.js`: the feed's replay. `test/working-line.test.js`: a run that starts again, and what the server holds and sends while a script job's script runs (no run, no line).
- ALV-004, `test/groups-web.test.js`, `test/chief-line-web.test.js` and `test/working-line-web.test.js`: the page draws a member's line and the Chief's line as the server says them, holds no words of its own for a running run's step or for the Chief's tools, and shows the lines as before against an older server.
- Android (ALV-003): the unit tests (`WorkingLineTest` for the line with the feature, without it, a change, the reply, Stop, a reconnect and a chat opened again, a job's run and "Waiting for your OK"; `StopLineTest` and `BotSubTest` for the words that now read as on the web page), lint and the debug build passed.
- Android (ALV-004): the unit tests (`GroupWorkingLineTest` for a member's line with the feature, without it, two members one after another, a chat opened again, the end of a turn and "Waiting for your OK"; `ChiefWordsTest` for the Chief's line in the server's words, "Working" against an older server, and that the app holds no words of its own for the Chief's tools), lint and the debug build passed.
- Android: not walked on the emulator or on a phone before the owner's test.
- The web page was not walked in a browser for this ticket, and no bot answered for real: the checklist below is the first look on screen.

## How to start it

A test botdot server with scratch data, on this Mac, from this branch:

`PORT=4801 HOST=0.0.0.0 BOT_DOT_DATA=<scratch folder> node server.js`, then open http://localhost:4801. It uses this Mac's Claude sign-in, so bots answer for real.

## Checklist

On the web page.

1. Open a bot and send: "Read the front page of nytimes.com and tell me the top story in one sentence." Under your message there is one line with a pulsing dot and **Stop**: first "Working", then what the bot says it is about to do, then lines such as "Reading nytimes.com" as it works. It is always one line: no bubble, no step list, no Details.
2. While it works, look at the bot's row in the list: it reads the same words as the line under the chat, and changes with it.
3. The line never changes faster than about once a second, also when the bot does several things quickly.
4. Reload the page while the bot works: the line is back as it was, and goes on changing.
5. When the reply arrives, the line and Stop go, and the reply stands in their place. The row shows the reply.
6. Send a longer task and press **Stop** while the line shows a step: the line goes at once and the run shows as stopped.
7. Open a bot that has a computer and ask it to open a web page in its browser while its computer is off: the line reads "Starting its computer" while the computer starts, then what the bot is doing on it ("Opening nytimes.com", "Using its computer").
8. Ask a bot to message a teammate ("Ask Web Surfer for today's weather in Brussels"): the line reads "Messaging Web Surfer".
9. Send a question a bot answers without tools ("What is 12 times 12?"): the line reads "Working" until the reply.
10. Open a bot's jobs and press **Run now** on a job that uses AI: the line and the row read "Running <the job's name>", then follow its work. Press **Run now** on a job that is a script and takes a few seconds (`sleep 5; echo done`): there is no line and no Stop while it runs, and its run appears in the chat when it has ended.
11. With a bot that uses a connected app, start an action that needs your OK: the line reads "Waiting for your OK" with a still dot, as before, and returns to the bot's work after your answer.
12. Read the lines as they pass: none shows a whole web address, a file's path, a command or anything you typed into a login.

### Groups and the Chief of Staff (ALV-004)

On the web page. Android follows in its own steps.

13. Open a group of two bots and write: "Both of you: read the front page of nytimes.com and say what the top story is." Under your message the first member's line reads its name and then what it is doing, first "Working", then what it says it is about to do, then lines such as "Reading nytimes.com", with **Stop all** at the end. The words are the ones the same bot shows in its own chat for the same work.
14. When the first member has answered, the second member's line takes its place and follows that member's work. It never shows the first member's last words.
15. While a member works, look at the group's row in the list: it reads the member's name and the same words as the line under the chat.
16. Reload the page while a member works: its line is back as it was, and goes on changing.
17. Press **Stop all** while a line shows a step: the lines go at once.
18. Open the **Chief of Staff** and ask: "Read the front page of nytimes.com and tell me the top story." Its line reads "Thinking", then what the Chief says it is about to do, when it says so, and that stays while the step it announced runs; then the same words a bot shows for each step that follows ("Reading nytimes.com", "Searching the web"), and "Thinking" between those steps. The line does not stay on the opening words for the whole reply, and it never changes faster than about once a second.
19. Ask the Chief to remember something ("Remember that I like short answers"), and to ask a bot for something ("Ask Web Surfer for today's weather in Brussels"): its line reads "Saving a note", then "Starting a bot" and "Waiting for Web Surfer", as before.
20. Reload the page while the Chief waits for a bot: the line is back. Press **Stop**: the line goes.
21. Open a bot that has a computer while it works, and open its computer's window: under the screen "What it's doing" reads the same one line as the bot's chat. There is no list of steps under it any more.
22. Open **Activity** and a run that is going on: its bubble reads the same one line as the bot's chat until the answer. Open a finished run and **Show details**: its steps are listed as before.

## Failure cases to try

- Stop the test server while a bot works: the page says the server can't be reached. Start it again: the run shows as cut off and no line is left under the chat or in the row.
- Press Stop at the moment the reply arrives: nothing breaks, and no line stays behind.

## What cannot be tested by hand

- A server from before the working line: the page then shows the opening line for the whole run, as before, for a bot and for a member of a group. Covered by `test/working-line-web.test.js` and `test/groups-web.test.js`. Against such a server the Chief's line reads its opening line, or "Working" without one, for a tool the server sent no words for, where the page had its own words before, and that server's "Thinking" and "Waiting for …" after it; `test/chief-line-web.test.js`.
- That a change is held back for a second and the last one always goes out: covered by `test/working-line.test.js`, with a clock moved by hand and on the real server, and for the Chief's line by `test/chief-line.test.js`.
- That many changes of a line do not make a phone that comes back reload everything: of a run's changes the feed keeps the newest for a replay. Covered by `test/line-events.test.js` (two thousand changes, then a reconnect with an old `Last-Event-ID` and with `since`).
- A run that starts again after Claude's sign-in was renewed reads its job's name again: covered by `test/working-line.test.js`.
- That the run's log grows no faster: covered by `test/working-line.test.js`.

## Android

The debug app built from this branch, on the emulator or a phone, connected to the test server above.

1. Open a bot and send: "Read the front page of nytimes.com and tell me the top story in one sentence." Under your message there is one line with a pulsing dot and **Stop**: first "Working…", then what the bot says it is about to do, then lines such as "Reading nytimes.com…" as it works. It is always one line: no bubble and no step list.
2. Go back to the list while it works: the bot's row reads the same words as the line under its chat, and changes with it. A working bot that has no line yet reads "Working…" with a capital W, as on the web page.
3. Open the same bot on the web page beside the phone: both show the same words, and change together.
4. While the bot works, leave the chat and open it again: the line is back as it was, and goes on changing.
5. While the bot works, turn the phone's network off for a few seconds and on again: after "Can't reach botdot" has gone the line is the one the web page shows, not the one from before. Do the same with a busy bot and a minute without network: the chat is still there as it was, with what happened meanwhile, and is not loaded from nothing.
6. When the reply arrives, the line and Stop go, and the reply stands in their place. The row shows the reply.
7. Send a longer task and press **Stop** while the line shows a step: the line goes and the run shows as stopped.
8. Open a bot that has a computer and ask it to open a web page in its browser while its computer is off: the line reads "Starting its computer…" while the computer starts, then what the bot is doing on it.
9. Open a bot's jobs and press **Run now** on a job that uses AI: the line and the row read "Running <the job's name>…", as on the web page, then follow its work.
10. Press **Run now** on a job that is a script (one that takes a few seconds, such as `sleep 5; echo done`): while it runs there is no line and no Stop under the chat and the bot's row is as it was, as on the web page. When the script has ended with something to show, its run appears in the chat. (A script job has no run while its script runs.)
11. With a bot that uses a connected app, start an action that needs your OK: the line reads "Waiting for your OK" with a still dot, as before, and returns to the bot's work after your answer.
12. No notification comes for a line, and a line never makes a dot or moves the "New" line.

### Groups and the Chief of Staff on Android (ALV-004)

13. Open a group of two bots and write: "Both of you: read the front page of nytimes.com and say what the top story is." Under your message the first member's line reads its name and then what it is doing: first "Working…", then what it says it is about to do, then lines such as "Reading nytimes.com…", with **Stop all** at the end. The words are the ones the same bot shows in its own chat for the same work.
14. When the first member has answered, the second member's line takes its place and follows that member's work. It never shows the first member's last words.
15. Go back to the list while a member works: the group's row reads the member's name and the same words as the line under the chat, and changes with it.
16. Open the same group on the web page beside the phone: both show the same words, and change together.
17. While a member works, leave the group and open it again: its line is back as it was, and goes on changing.
18. Press **Stop all** while a line shows a step: the lines go.
19. Open the **Chief of Staff** and ask: "Read the front page of nytimes.com and tell me the top story." Its line reads "Thinking…", then what the Chief says it is about to do, when it says so, and that stays while the step it announced runs; then the same words a bot shows for each step that follows ("Reading nytimes.com…", "Searching the web…"), and "Thinking…" between those steps. The line does not stay on the opening words for the whole reply. The web page beside the phone shows the same words.
20. Ask the Chief to remember something ("Remember that I like short answers"), and to ask a bot for something ("Ask Web Surfer for today's weather in Brussels"): its line reads "Saving a note…", then "Starting a bot…" and "Waiting for Web Surfer…", as before.
21. While the Chief waits for a bot, leave its chat and open it again: the line is back. Press **Stop**: the line goes.

What cannot be tested by hand on Android: a server from before the working line, against which the app shows the opening line for the whole run as before, for a bot and for a member of a group. Covered by `WorkingLineTest` and `GroupWorkingLineTest`. Against such a server the Chief's line reads its opening line, or "Working…" without one, for a tool the server sent no words for, where the app had its own words before; `ChiefWordsTest` and `StopLineTest`.

## Owner acceptance

Not tested by the owner yet.
