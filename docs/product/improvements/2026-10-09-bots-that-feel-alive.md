# Bots that feel alive

9 Oct 2026. An improvement report; no code was changed. Revision read: `7d40d71` on branch `t3/improve-bot-reactivity`.

## Question

The owner wants botdot's bots to feel more alive and reactive, and asked how. Scope: the web page (`public/`) and the Android app (`android/`), both windows onto one botdot server (`server.js`, `lib/`). The Mac app is left as it is ([ADR 008](../../adr/008-the-mac-app-is-no-longer-developed.md)).

## Criterion

None was confirmed by the owner for this report. It uses the one the question implies:

- **A sign of life in time.** After the owner does something, and all through a bot's work, the screen shows within the limits people notice (0.1 s, 1 s, 10 s, see "What works") that the bot took it, is at it, and what it is at.

"Feels alive" is the owner's word and is judged by the owner, as the Milestone 2 research already said (`docs/archive/product/milestone2-research.md:32`).

## Observed

Nothing was run for this report. No test server was started, the Android app was not built, and no time was measured with a clock. Every finding below is read from the code at the revision above. The time from a sent message to the first sign of the bot's own words is therefore described as a path of steps, not as seconds: a run's log keeps its events without a time each (`lib/bots.js:1215-1220`), so the logs cannot give it either.

Two short answers the question asked for:

- **Does reply text stream today? No.** A bot's reply and the Chief's reply arrive whole, when Claude Code's `result` line comes (`lib/bots.js:1337-1356`, `lib/chief.js:778-790`). Claude Code is started without `--include-partial-messages` (`lib/bots.js:1033`, `lib/chief.js:660`), so the botdot server itself is given no text before a whole block is written.
- **What transport do the apps use? Server-Sent Events, with a slow poll behind it on the web page.** Three SSE routes: the live feed `GET /api/events` (`server.js:2540-2563`, a ping every 20 s and `retry: 5000`), one run `GET /api/runs/:id/stream` (`server.js:693-712`, ping every 15 s) and one Chief chat `GET /api/chief/chats/:id/stream` (`server.js:2092-2099`). The web page uses `EventSource` (`public/app.js:5895`, `:2806`, `:2556`) and re-reads its lists every 60 s while the feed is connected, every 8 s when it is not (`public/app.js:6037-6039`). Android uses OkHttp's SSE client (`android/app/src/main/java/dev/botdot/app/data/Api.kt:450-457`), reconnects from 2 s up to 60 s (`feed/Feed.kt:60-81`) and has no list poll of its own. There is no WebSocket except the bot's computer screen (`server.js:2637`).

## Findings: what shows life today

Paths under `android/` are shortened to the part after `android/app/src/main/java/dev/botdot/app/`.

### The head and its face

1. **Six states, decided once on the botdot server.** In this order: `needs_you` (a login, a memory change, an ask, an open question, or a job that waits), `working` (a run is going), `waiting` (it asked teammates and their answers are not all in), `failed` (its last run ended in an error), `paused` (it has jobs, all switched off), `idle` (`server.js:552-567`). The first that fits wins.
2. **Five of the six move at rest, in a loop.** The definition gives each state a movement: idle blinks once in 5 s, working moves its pupils side to side every 1.4 s, waiting glances down once in 6 s, needs you bobs every 0.9 s, failed tilts over 4 s; paused has none and is drawn at 0.4 opacity (`lib/figure.json`, `states`). Both apps draw from that one definition ([ADR 003](../../adr/003-one-figure-definition-for-all-apps.md)): the web page as CSS keyframes that run forever (`public/figure.js:160-173`), Android from a frame clock that runs only while a head on screen is moving (`ui/FigureClock.kt:40-104`, `ui/BotFigure.kt:89-100`).
3. **Reduced motion is respected in both.** The web page stops every head's animation under `prefers-reduced-motion: reduce` (`public/style.css:164-166`); Android's clock never runs when the system's animation scale is 0 (`ui/FigureClock.kt:64`). Each state keeps its own still face.
4. **A change of state is a cut.** Neither app moves a head from one state's face to the next: the web page draws the SVG again (`public/app.js:100`), Android draws the new face on the next frame (`ui/BotFigure.kt:89-100`). The definition can only loop: "a movement that plays once" needs a new format version in every renderer (`docs/adr/003-one-figure-definition-for-all-apps.md:132`).
5. **The Chief of Staff has two faces only:** working while any Chief chat is replying, idle otherwise (`public/app.js:111`, `ui/HomeScreen.kt:287`, `ui/ChiefScreen.kt:145`).

### From Send to the first sign

6. **What the botdot server does, in order.** `POST /api/bots/:id/run` takes the message (`server.js:2261-2275`). The run's record is written and `run_started` goes to the feed at once (`lib/bots.js:1202-1203`). Then, before Claude Code exists: the check that Claude is signed in and the lookup, which may wait up to 1.5 s for meaning search (`lib/bots.js:1383-1384`, `lib/memory.js:139`). Then Claude Code starts (`lib/bots.js:1301`). Its lines are read one by one (`lib/bots.js:1309-1359`).
7. **The first words of the bot come late by design.** The opening line is the first text before the run's first tool call, and it is held until that tool call is seen, because text with no tool call after it is the reply (`lib/opening-line.js:5-7`, `:23-39`). So the line appears only after the model has written its sentence and its whole first tool call. A run that uses no tool has no line at all: the owner sees "Working" until the whole reply is there.
8. **What the owner sees on the web page.** On Send the box empties and the button is disabled (`public/app.js:2253-2258`). In a bot's chat the owner's own message is drawn only after the POST answered and five lists were read again, the newest 200 runs among them (`public/app.js:2778-2780`, `:505-510`); the POST's own answer, which holds the run, is not used. In the Chief's chat the bubble is drawn when the POST answered (`public/app.js:2537`). Nothing in between says "taken".
9. **What the owner sees on Android.** The same: the box empties at once (`ui/Components.kt:713-716`), Send greys out while the message is on its way (`ui/Components.kt:707`), and the message appears after the request and a refresh (`ui/ChatModels.kt:184-189`).
10. **The head turns to "working" one round trip later.** The apps hear `run_started`, wait 300 ms (web, `public/app.js:5894`) or 250 ms (Android, `data/Store.kt:51`, `:212`), then read the bots again, and only that answer carries the new `state`.

### While a bot works

11. **One line, by the owner's decision.** A working bot is one status line under its chat, with a pulsing dot in its colour and Stop: "Working", then its opening line (`public/opening-line.js:29-38`, `public/style.css:193-199`; `data/OpeningLine.kt:45-50`, `ui/Components.kt:350-368`). The row in the list says the same (`public/app.js:752`, `ui/HomeScreen.kt:561`). The step bubble and Details of a running run were removed on purpose on 2 Oct 2026 (`docs/product/milestone2.md:175`, `docs/archive/product/feature-working-bot-one-line-test.md`).
12. **After the opening line, the line never changes.** The server sends `opening_line` once per run (`lib/bots.js:1331-1336`). Both apps follow the run's stream and throw its steps away: the web page passes an empty function for them (`public/app.js:2790`), Android writes `is RunEvent.Step -> Unit` and `is RunEvent.Text -> Unit` (`ui/ChatModels.kt:228-229`). A run may go on for 60 minutes (`lib/bots.js:1389`).
13. **The Chief's line does change.** The server sends `activity` for each of the Chief's tool calls, with its own words for some ("Saving a note", "Waiting for Web Surfer") and "Thinking" between them (`lib/chief.js:509-510`, `:717-730`), and both apps draw it (`public/app.js:2561-2562`, `ui/ChatModels.kt:473`).
14. **One wait has its own words:** "Waiting for your OK", with a still dot, while an action in a connected app waits on a card (`lib/connector-approvals.js:54`, `public/opening-line.js:21`, `public/style.css:199-201`).
15. **A file shows at once.** A file a bot attaches is drawn while it still works (`public/app.js:2790-2798`, `ui/ChatModels.kt:231`).

### Replies, dots, the "New" line, notifications

16. **The reply arrives whole and replaces the line.** `run_finished` takes the line away, and the refresh that follows draws the reply (`public/app.js:5953-5957`). Nothing animates its arrival: the web page has no rule for a new bubble (`public/style.css:212-215`), and Android's chat rows have keys but no `animateItem` (`ui/BotChatScreen.kt:190`).
17. **Dots and the "New" line are the server's.** The count of new replies and the first of them come with every bot and on the feed's `unread` (`server.js:579-580`, `public/app.js:5901-5905`); a chat opened with new replies shows the "New" line (`public/style.css:191-192`). This part is finished work ([ADR 005](../../adr/005-read-positions-on-the-server.md)).
18. **Only Android tells the owner when the app is not in front.** It keeps the feed open in a foreground service and notifies for a new reply (`feed/Notifier.kt:222-246`). The web page has no notification, no change to the tab's title and no mark on its icon: `public/app.js` and `public/index.html` hold no `Notification`, `document.title` or `serviceWorker`. Its one sign outside a chat is the pulsing dot of the logo while anything works (`public/app.js:571`, `public/style.css:67-69`).

### The Chief of Staff writes first

19. **A look, at most three unasked messages a day.** Four looks a day, spread outside quiet hours, none in the first hour and none caught up later (`lib/look.js:23-27`, `:216`). Only the Chief does it; "other bots writing first" is an exclusion of Milestone 3 (`docs/product/milestone3.md:67`). The message is a plain Chief reply with 👍 and 👎.

### Groups

20. **One line per member at work, one "Stop all".** The group's chat carries `working` with each member's opening line (`lib/group-chat.js:561`, `:651`); the web page draws a line per member with its name (`public/groups.js:413-420`), and so does Android (`ui/GroupChatScreen.kt:347`). The group's row names the member at work (`public/groups.js:58-60`).
21. **Turns come one after another**, by decision (`docs/product/milestone10.md:103`), so a group of six answers in six runs (`docs/product/milestone10.md:151`). Between two turns no member is at work and no line stands.
22. **Who is next is sent and not drawn.** Every message of the owner's in a group has `next`, "the members whose turn has not come yet, in the order they will have it" (`docs/api.md:203`, `lib/group-chat.js:204`). The web page never reads it (`public/groups.js` holds no use of it), and Android parses it and draws nothing from it (`data/Groups.kt:123`, `:132`).

## Where it feels inert

Each gap names the finding it comes from.

| # | Gap | Where |
| --- | --- | --- |
| G1 | **No acknowledgement of a sent message.** For at least one round trip, and in a bot's chat on the web page two, the owner's own words are nowhere: not in the box, not in the chat. On a phone through a tunnel that is the longest wait of the 0.1 s kind. | 8, 9 |
| G2 | **"Working" says nothing until the first tool call is whole.** The sign-in check, the lookup, Claude Code's start and the model's first block all pass under one word. A run without tools never gets a second sign before its reply. | 6, 7 |
| G3 | **The line stands still for the rest of the run.** After the opening line nothing on screen changes until the reply, for up to an hour. The pulsing dot and the moving eyes loop the same way whether the bot is on its second step or its fortieth, or is stuck. | 11, 12 |
| G4 | **The steps exist and are dropped.** The server already puts each tool call in plain words for Android (`server.js:650-668`) and both apps receive them. "Starting its computer" (`lib/bots.js:1431-1434`) reaches the web page's run page only (`public/app.js:1953-1954`) and never Android: the simple stream leaves `phase` out (`server.js:656`). | 12 |
| G5 | **A bot and the Chief differ.** The Chief's line follows its work; a bot's does not. | 12, 13 |
| G6 | **The reply lands in one piece, without a sign of landing.** A long reply is waited for whole, then replaces the line in one redraw. | 16 |
| G7 | **States that look or read alike.** A bot with a card waiting shows `needs_you` whether it is working or not, because `needs_you` is asked first (`server.js:556-557`). A `waiting` bot has its face but no words: its row shows its last reply (`public/app.js:728-732`), though the server knows whom it waits for. A change of state is a cut, so a glance away misses it. | 1, 4 |
| G8 | **The web page is silent when not in front.** A new reply, a card or a question changes nothing the owner can see from another tab. | 18 |
| G9 | **A group goes blank between turns**, and who comes next is known to the server and drawn by no app. | 21, 22 |
| G10 | **Words chosen per app.** The web page has its own step words (`public/app.js:1703-1727`), Android its own for the Chief's tools (`ui/ChatModels.kt:457`, `:473`), the server a third set (`server.js:649-668`, `lib/memory.js:106`). A job's script run reads "Running <job>" on Android and "Working" on the web page (`data/OpeningLine.kt:48-49`, `public/opening-line.js:33`); the row says "working…" on Android and "Working…" on the web page (`ui/HomeScreen.kt:561`, `public/app.js:752`). | 11 |
| G11 | **Events no app draws.** `bot_message` (who wrote to whom, with a preview) and `waiting` only trigger a refresh (`public/app.js:5899`, `data/Store.kt:168`); `next` in a group (G9). | 22 |

## What works, from the sources that own the claim

Opened for this report on 9 Oct 2026 unless marked.

**Response time.**
- Three limits: 0.1 s "is about the limit for having the user feel that the system is reacting instantaneously", 1 s "is about the limit for the user's flow of thought to stay uninterrupted", 10 s "is about the limit for keeping the user's attention focused on the dialogue". When the whole length is not known, "it is still possible to provide running progress feedback", such as naming what has been done so far; a spinner is the last resort, since it shows that the system works and not what it does. Nielsen Norman Group, https://www.nngroup.com/articles/response-times-3-important-limits/. The article gives Miller 1968, Card et al. 1991 and Myers 1985 as its sources; those three were **not opened: unverified at the source**.
- A looped animation is "distracting" under 1 s and "should be reserved for actions that take between 2-10 seconds"; over 10 s a percent-done indicator is advised, and a looped one "doesn't give any information about how long the user will have to wait". Nielsen Norman Group, https://www.nngroup.com/articles/progress-indicators/. The same page reports a University of Nebraska-Lincoln study in which people waited about three times longer with a moving indicator: **the study itself was not opened: unverified at the source**.
- How a progress display behaves changes how long the wait feels, at the same real length. Harrison, Amento, Kuznetsov and Bell, "Rethinking the Progress Bar", UIST 2007, pp. 115-118, as listed on the first author's page https://www.chrisharrison.net/index.php/Research/ProgressBars. **Only the title, venue and one sentence of the abstract were read; the paper at ACM answered 403. Its findings are unverified here.**

Read against botdot: G1 is a 0.1 s matter, G2 a 1 s to 10 s matter, and G3 lies past every limit, where the advice is running feedback that names the work, which is what G4 says the server already has.

**What Claude Code can give the botdot server.** botdot starts `claude -p --output-format stream-json --verbose` (`lib/bots.js:1033`, `lib/chief.js:660`).
- Without partial messages, a complete message is given "for each non-empty content block, such as a text block or a tool call, after Claude finishes generating that block". https://code.claude.com/docs/en/agent-sdk/streaming-output. This is why finding 7 holds.
- `--include-partial-messages`: "Include partial streaming events in output. Requires `--print` and `--output-format stream-json`". https://code.claude.com/docs/en/cli-reference. With it the stream carries `stream_event` lines whose `event` is the raw API event: `message_start`, `content_block_start`, `content_block_delta` (with `text_delta` for text and `input_json_delta` for a tool call's input), `content_block_stop`, `message_delta`, `message_stop`. They are "raw Claude API events, not accumulated text", and are "emitted for the main session only". https://code.claude.com/docs/en/agent-sdk/streaming-output and https://code.claude.com/docs/en/headless ("Stream responses").
- The order with partial messages on: the text block's chunks, then the complete text block, then the tool call's chunks, then the complete tool call. So the server can know that a tool call has begun (`content_block_start` of type `tool_use`, with the tool's name) before its input is written. Same page.
- `system/api_retry` is sent before Claude Code tries a failed request again, with `attempt`, `max_retries`, `retry_delay_ms` and an `error` category: "You can use the event to show retry progress in your own interface." `system/init` is the first event and says the session is up. https://code.claude.com/docs/en/headless. botdot reads `init` for the session, the model and the skills (`lib/bots.js:1319-1321`) and draws nothing from either.
- `--include-hook-events` adds hook lifecycle events to the stream. https://code.claude.com/docs/en/cli-reference. Not needed here: the tool calls are in the stream already.

**The web page.**
- `prefers-reduced-motion` detects "a setting on their device to minimize the amount of non-essential motion"; the advice is to replace such motion inside `@media (prefers-reduced-motion: reduce)`. https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion. botdot does this for heads, the line's dot, the logo and tiles (`public/style.css:69`, `:164`, `:210`, `:510`, `:627`), and not for the three bouncing dots of the run page (`public/style.css:253-256`).
- Server-Sent Events not over HTTP/2 are limited to 6 open connections per browser and domain, across all tabs. A comment line keeps a connection alive, `retry` sets the wait before a reconnect, and `id` sets the last event id. https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events. botdot's page holds the feed and at most one run stream and one Chief stream per tab (`public/app.js:5895`, `:2787-2790`, `:2555-2556`), so two tabs fit and a third may not. A proposal that opens one more stream per chat would make that worse; the proposals below add events to the streams there are.
- WCAG 2.2.2 (level A): anything moving or blinking that starts by itself, lasts more than five seconds and stands beside other content needs a way to pause, stop or hide it, unless it is essential; an animation that shows a wait can be essential when not showing it "could confuse users or cause them to think that content was frozen or broken". https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html. The heads and the line's dot are of that kind today; the system setting is the only way to still them. More endless motion has to pass the same test, which speaks for motion that plays once on an event.

**Android.**
- `AnimatedContent` animates between contents, by default "the initial content fades out and then the target content fades in"; `Crossfade` for a plain fade; `AnimatedVisibility` to show or hide; `animateContentSize` for a change of size. https://developer.android.com/develop/ui/compose/animation/quick-guide and https://developer.android.com/develop/ui/compose/animation/composables-modifiers.
- In a lazy list, "The animateItem modifier applies default animations to item additions, removals, and moves", and items need keys. https://developer.android.com/develop/ui/compose/lists. botdot's chat rows have keys already (`ui/BotChatScreen.kt:190`).
- **Material Design's motion guidance could not be read:** https://m3.material.io/styles/motion/overview returned a page without its text. Nothing in this report rests on it. **Unverified.**

**Other products**, from botdot's own earlier note and not opened again: Telegram and Slack both prefer a status that clears itself over a saved "please wait" message (`docs/archive/product/milestone2-research.md:126-127`), which is what the opening line became.

## Tests a change must keep passing

Not run for this report; found by name.

- The opening line's rules: `lib/opening-line.js` and its tests under `test/`, and Android's `OpeningLine` tests. The line "is never a new reply and never part of the chat" (`CONTEXT.md`, "Opening line").
- The web tests that cut functions out of `public/app.js` by their first and last line (`docs/product/improvements/2026-10-08-chat-reply-readability.md`, "Tests a change must keep passing").
- The figure fixture the renderers share ([ADR 003](../../adr/003-one-figure-definition-for-all-apps.md)).
- A run's events are appended to its log as they happen (`lib/bots.js:1215-1220`, `docs/DECISIONS.md`, 9 Oct 2026): anything streamed in small pieces must not go through `record`, or every run's log grows by thousands of lines.

## Proposals

Ranked by effect on the criterion against effort. They are for the owner to choose from: none is a plan. "Feature" in the API column means a new entry in `features` and a section in `docs/api.md`, in the same change (AGENTS.md, rule 4).

| # | Proposal | The owner would see | The botdot server | The web page and Android | Builds on | Size | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **The sent message is there at once.** | Their own bubble the moment they press Send, and the working line "Working" under it, in a bot's chat, the Chief's and a group. If it did not go, it is back in the box as today. | Nothing new. The message's key already makes one message of a send and its repeat (`docs/api.md:588-590`). | Each draws the owner's text at once, faded as a waiting message is, and puts the server's version in its place when the POST answers: the run, or the waiting message from `queued`. The web page also stops reading five lists before it draws (finding 8). | `public/app.js:2253`, `:2537`, `:2778`; `.bubble.from-me.waits` at `public/style.css:208`; `ui/ChatModels.kt:184-189`, `:615` | A day, both apps | The same text drawn twice for a moment if the local bubble and the server's are not matched by the key. This is the one place where an app draws before the server spoke: it draws the owner's own words, decides nothing, and gives way to the server's answer. |
| 2 | **The working line follows the work.** | Still one line with Stop. After the opening line it goes on in the server's words: "Reading nytimes.com", "Starting its computer", "Messaging Web Surfer", "Writing the answer". A bot and the Chief behave alike. | Decides the words once (it has them: `server.js:649-668`, `lib/memory.js:106`, `lib/chief.js:509-510`) and sends the line as it changes: on the feed, on a running run, in the run's stream, as the opening line is. Holds a change back so the line never flickers (one change a second at most). Feature. | Draw the server's text in the line they have. The web page's own step words (`public/app.js:1703-1727`) and Android's (`friendlyTool`) go: G10 closes with it. | `lib/bots.js:1320-1336`; `public/opening-line.js`; `data/OpeningLine.kt` | A day or two | It changes a decision: the owner chose "one line saying what it is about to do" (`docs/product/milestone2.md:175`) and the vocabulary says the opening line is "the one short line" and to avoid "progress message, narration" (`CONTEXT.md`). The line stays one line and keeps Stop; its words change. Needs the owner's yes and a word for it in `CONTEXT.md`. A step's words can hold part of a command or an address: they are plain text, cut by the server (rule 6). |
| 3 | **A group shows who is next.** | Under the line of the member at work: the small still heads of the members to come, in order. Between two turns the place is not blank. | Nothing new: `next` is sent (`docs/api.md:203`). | Draw `next` of the message whose turn is at work, as small heads (`Figure.small`, `SmallFigure`), which never move. | `public/groups.js:413-420`; `data/Groups.kt:123`; `ui/GroupParts.kt` | Hours, both apps | Low. With two lines of turns side by side, which message's `next` to show needs one rule. No digits: heads, as Needs you does. |
| 4 | **A reply arrives, visibly.** | A new reply fades and slides in once instead of replacing the screen; the line gives way to it in the same motion. Nothing moves for a reply that was already there when the chat opened. | Nothing. | Web: one CSS animation on a bubble whose run was not on screen before, off under `prefers-reduced-motion`. Android: `animateItem` on the chat's rows, off when the clock is still (`ui/FigureClock.kt:64`). | `public/style.css:212-215`; `ui/BotChatScreen.kt:190` | Hours to a day | The web page rebuilds a chat's markup on a refresh (`public/app.js:2691`), so "new" must be told by run id or every redraw would animate. |
| 5 | **The web page's tab tells.** | In another tab: a mark before "botdot" in the tab's title, and on its icon, while any chat has a new reply or anything waits in Needs you. A mark, not a count. | Nothing: `unread`, `asks` and `approvals` are on the feed. | The web page only. Android has notifications (finding 18). | `public/app.js:5901-5919` | Hours | Low. Not browser notifications: see "Rejected". |
| 6 | **The reply is written as you watch.** | The reply's words appear as the bot writes them, in the bubble the reply will stay in. | Starts Claude Code with `--include-partial-messages`, and passes on the text of the main session through the streams there are. It decides what is shown: a text block that a tool call follows is not the reply and is withdrawn (as `lib/chief.js:757` already does for the Chief); a last line that begins `[[` is held back, since it becomes buttons or a card (`lib/bots.js:1340`); a turn in a group is not written out until it is known not to be a pass (`lib/bots.js:1255`). The pieces are not written to the run's log. Feature. | Draw the text as it grows, through the Markdown they have, which must take a half-written list or table without jumping. | `lib/bots.js:1309-1359`, `lib/chief.js:733-792`; `public/app.js:2551`; `ui/ChatModels.kt:226-233` | Several days | The highest here. Words that appear and are taken back if a tool call follows; half-drawn Markdown; the opening line's rule ("nothing is a line until that first tool call is seen") has to live beside it. Only the main session streams, which is what botdot wants. It also brings the first sign of G2 forward, for a run without tools, from the whole reply to its first words. Better taken after 2, which makes the same change to how the stream is read. |
| 7 | **States that read apart.** | A bot that works while a card of its waits looks at work, with the card still counted in Needs you. A waiting bot's row says whom it waits for ("Waiting for Web Surfer"). | Decides both: the order in `botStates` (`server.js:552-567`), and one field with the words for a waiting bot (it knows the names: `lib/awaits.js`). Feature for the field. | Draw the state and the text they are given. | `server.js:552-567`; `public/app.js:728-732`; `ui/HomeScreen.kt:556-566` | Hours to a day | "Changes to how a state is decided" was out of scope for Milestone 1 (`docs/product/milestone1.md:73`) and has not been decided since: the order is the owner's to choose. A head that works while it needs the owner could hide the need; the row's "Asks:" and Needs you still say it. |
| 8 | **A head that reacts once.** | A short movement when something happens to a bot: it looks up when the owner's message is taken, nods when its reply lands. Then its state's loop again. | The movements are data in `lib/figure.json`, one per event, under a new format version. | Both renderers learn a movement that plays once. | [ADR 003](../../adr/003-one-figure-definition-for-all-apps.md); `public/figure.js:160-173`; `data/Figure.kt`; `ui/FigureClock.kt` | Several days, with an ADR | ADR 003 says this "needs a change to the model in all three renderers and a new `version`" (`:132`); an app with the old version keeps its bundled definition. The Mac app would stay on version 2. The most charm and the least information: last for that reason. |

Proposals 1, 3, 4 and 5 need no change to the API. Proposals 2, 6 and 7 change what the server sends. Proposal 8 changes the figure's format.

## Rejected

- **The step list or a typing bubble under a working bot.** The owner removed it: a working bot is one line (`docs/product/milestone2.md:175`). Proposal 2 keeps the one line.
- **A percent, a bar or a time left.** The length of a run is not known, and a percent-done indicator is for work whose length is (Nielsen Norman Group, above). Counting tokens or turns would be a usage figure on screen, against rule 5.
- **An ongoing Android notification for the line.** Decided out in Milestone 2 (`docs/product/milestone2.md:62`).
- **Bots other than the Chief writing first, or the Chief writing more often.** An exclusion of Milestone 3 (`docs/product/milestone3.md:67`); how often is steered by chat, not by a control (`docs/product/milestone3.md:52`). A bot already reaches the owner through a scheduled job's report.
- **👍, 👎 or reactions on ordinary replies.** Excluded in Milestone 3 (`docs/product/milestone3.md:70`) and in Milestone 2 (`docs/product/milestone2.md:79`).
- **Members of a group answering at the same moment.** Decided against in Milestone 10 (`docs/product/milestone10.md:103`).
- **Browser notifications on the web page.** They need the browser's permission question, which is a control, and to reach a closed tab they need a service worker and push, a new technology that takes an ADR (AGENTS.md, "Stack"). Proposal 5 covers the open tab without either.
- **Sounds.** A sound needs a way to switch it off, which is a new control (rule 5).
- **Showing the bot's thinking.** It is not the reply, bots are told not to narrate (`lib/bots.js:61`), and it would be Claude's text drawn before the server has read it whole (rule 6).
- **Sorting the list by the latest reply**, so that a bot that just answered jumps up. The list stays in the owner's order (`docs/product/milestone2.md:56`).
- **Anything for the Mac app.** [ADR 008](../../adr/008-the-mac-app-is-no-longer-developed.md).

## Already fine

- **Heads move at rest and stand still on request** (findings 2, 3).
- **Dots, the "New" line and Android's notifications** follow one read position on the server (finding 17).
- **A waiting message, Stop and "Waiting for your OK"** each have their own look (finding 14; `public/style.css:205-208`).
- **A reconnect loses nothing:** the feed replays what was missed by `Last-Event-ID` (`lib/events.js:43-53`), and the run's stream replays the run and its opening line (`server.js:697-705`).
- **A file a bot attaches shows at once** (finding 15).

## Not verified

- No time was measured: the wait from Send to the first sign is a path read from the code (findings 6 to 10).
- Android was read, not run.
- That Claude Code's stream gives one event per finished block is from Anthropic's page; botdot's stream was not captured to confirm it for the version installed.
- Miller 1968, Card et al. 1991, Myers 1985 and the University of Nebraska-Lincoln study: cited through Nielsen Norman Group only.
- Harrison et al. 2007: title, venue and one sentence only.
- Material Design's motion guidance: the page gave no text.

## Verdicts

Chosen by the owner on 9 Oct 2026.

| # | Verdict |
| --- | --- |
| 1 | Now |
| 2 | Now |
| 3 | Now |
| 4 | Now |
| 5 | Now |
| 6 | Not now |
| 7 | Not now |
| 8 | Not now |

For proposal 2 the owner said yes to changing the 2 Oct decision: the line stays one line with Stop and follows the work. It is the **working line** in `CONTEXT.md`. The five are specified in [Kordal/bot-dot#329](https://github.com/Kordal/bot-dot/issues/329) and split into the tickets ALV-001 to ALV-009.
