# Milestone 6 test: an OK continues the work

Test document of [Milestone 6](milestone6.md), written by the acceptance task OK-006.

## Review

The milestone review ran on the diff from main, by the `kordal-reviewer` agent (Claude Opus 5.5), once per axis each time. Every finding was checked against the code before it was acted on.

| Pass | Reviewed | Result |
| --- | --- | --- |
| 1 | `main...8130109`, OK-001 to OK-005 | No high. Three medium, eleven low |
| 2 | `d721419...419d9de`, the fix task OK-007 only | No high. Four medium, four low |
| 3 | `419d9de...fbfbc20`, the fix task OK-008 only | No high. One medium in the diff, one medium older than it, seven low |
| 4 | `fbfbc20...5e9d076`, OK-009 and OK-010 only | No high or medium. Six low |

The security questions of pass 1 came back clean: only the owner answers a card; the wait of a connected-app action needs the run's own token; the Chief's chat taken from its tools' calls is used only as a destination; the late one-use grant is bound when its run starts, used once, gone with the run, and on disk only inside the queue file.

Medium findings, all fixed or decided by the owner:

1. **A connected-app card hid what it approved** (Standards; pass 1). A value was clipped at 500 characters and both apps drew the rows in place of the whole arguments. Fixed in OK-007: an opened card shows every argument and value in full.
2. **One Allow told the Chief twice** (Spec; pass 1; capability 6). Two runs the Chief started from one chat, both refused the same. Fixed in OK-007: the latest run of a chat carries on, once.
3. **A run the Chief had taken up could be started again** by a late "Allow once" (Standards; pass 1). Fixed in OK-007: a run the Chief was told about counts as carried on.
4. **Values without labels** on a closed web card of more than three rows (Standards; pass 2). Fixed in OK-008.
5. **A card without a bound** (Standards; pass 2): 120,000 arguments gave 120,000 rows. Fixed in OK-008: over 200 arguments or 100,000 characters the card says "Too long to show in full." and offers Decline and "Always allow this action"; "Allow once" is refused.
6. **The owner's request to the Chief counted as "asked again"** when its run joined an older card (Spec; pass 2; A4). Fixed in OK-008.
7. **Letters lost in a row's label** outside A to Z, and long names cut (Spec; pass 2). Fixed in OK-008.
8. **The feed's short entry lost its bound** when labels stopped being clipped (both axes; pass 3). Fixed in OK-009.
9. **A request the owner sent after the card appeared never carried on**, though it was refused the same and never done (Spec; pass 3; older than the fix tasks, and what A10 said word for word). Decided by the owner on 2026-10-06 and delivered in OK-010: a refused request carries on unless the owner sent the bot a message after it.

One more decision of the owner came from the first look: a bot whose jobs are all switched off still carries on with the owner's own request (OK-010).

### What cannot be relied on

- **What the Chief and the bots do once started.** The tests show what botdot hands over, against a stand-in for Claude. Two walks with real Claude went well (below); a bot that repeats work it already did, or a Chief that does not start the bot after being told, would show only in use.
- **A connected app.** The test server has none connected: the wait, "Allow once", the late OK and the too-long card were tested against a stand-in and drawn in a browser on stand-in asks. Nothing was sent through a real app.
- **Ten minutes.** No test waits out the real wait; that Claude Code keeps a tool call open that long is not shown.
- **An app from Milestone 5 against this server** was not run. By reading: its Allow carries on, and its cards show this server's new titles and words, because it already draws those fields. A19 said its cards keep their words.
- **Android's cards for the Chief's change and for a connected-app action** were not seen on the emulator: unit tests hold their words and data.
- **An unstable test.** `test/awaits.test.js` ("Timed out waiting for Coder to start") failed four task gate runs during this milestone and passed on each repeat; it is not from this milestone's code. The last eight gate runs passed at the first try.

### Follow-up

Low findings and open points, for the owner to decide; none is fixed.

Behaviour:

- A changed bot still answers "The bot changed since this proposal. Decline it and ask for a fresh proposal." when another permission was allowed first, the owner edited a field the change touches, or a second change was approved first. Following that advice writes "Declined: …" in the Chief's chat, and the Chief is told not to ask for the same again.
- Two cards of one run can bring the Chief two turns in one chat, one per Allow.
- Two requests of the owner that overlap in time (the second sent before the first was refused) can both carry on.
- After a message the bot answered, a job's later run that is refused runs again on Allow: the owner sent nothing after that run.
- The 24 hours count from the card, so a request that joins an old card has less than a day.
- Allow tapped while the owner's request is still running starts nothing.
- "Run now" of a job on a bot whose jobs are all switched off is not repeated after Allow.
- A teammate's request to such a bot carries on: this session's reading of the owner's decision, not the owner's words.
- A stopped connected-app card stays when the owner writes in the Chief chat that started its run; it goes when the owner writes to the bot.
- After a late OK, a run the Chief had started is started again by botdot itself, not handed to the Chief ([ADR 010](../adr/010-a-connected-app-action-waits-in-its-run.md)).
- The only yes on a too-long card is "Always allow this action", and a bot can make any card too long by padding.
- The answer of `GET /api/asks` is megabytes for a too-long action: `details` and `arguments` are sent whole, as before this milestone.
- A refused follow-up after teammates' answers gets a card whose yes starts nothing.
- A bot that asked for a permission and then finished another way is started again once.
- The Chief's reply says the card is "in Needs you" also when the card stands under that reply.
- The job dialog and the job card in a bot's settings do not say who carries on.
- Android: an older list of runs can bring "Waiting for your OK" back for a moment; the list row of a waiting bot still shows its opening line.
- A closed card's label wider than its column ends in "…", also on a changed bot's card.
- Look-alike letters of two scripts read alike in a row's label; a clipped label in the feed can end in half a character.

Documents and tests:

- ADR 009 and ADR 010 were amended in place by OK-002, OK-003 and OK-007 to OK-010 instead of superseded; the plans of OK-007 to OK-010 say "ADRs: none".
- `more` means "rows left out" in the feed and "too long" in the list. Both apps draw cards from the list only.
- The `carriesOn` sentences are written four times in `server.js`; `connectors-mcp.js` holds a second copy of the server's words for "no answer"; a tool ask still takes `chatId` from the body.
- `docs/archive/security-issue-90.md` still says "All four clients".
- No test restarts botdot with work waiting whose request joined an older card; the reviewer ran it by hand and it held.
- A6's "a watch job with nothing new stays silent" has no test of its own after a repeated run.
- `test/refused.test.js` cannot tell the later of its two requests from the earlier: both have the same words.
- The browser test `test/browser/carries-on.cjs` runs in no gate: the repository does not carry Playwright. It passed by hand on `54c64fe`.
- A plan must not link to another task's plan that has not moved yet: OK-003 could not be finished until OK-005's plan named it without a link.

## How to start it

From branch `task/ok-006`:

- **The botdot server:** a test server on this Mac with its own data folder (`.test-data`), started by the agent: http://localhost:4801. It uses the Claude sign-in of this Mac. It has three bots from the walks: News Reader, Headline Bot (both may browse the web now) and Tech Scout.
- **Android:** the emulator (Medium_Phone) with the debug app built from this branch, connected to that server through `adb reverse tcp:4801 tcp:4801`. The debug build for a real phone is `android/app/build/outputs/apk/debug/app-debug.apk`.
- For a phone on the tailnet, say "serve" and the agent starts Tailscale Serve for port 4801.

## What was walked before handing over

On 2026-10-06, on the test server, with real Claude:

- **A2, A18 (Android, emulator).** A bot without web access was asked for today's top technology headline. It said what it lacked; its card read "It carries on with “What is the top technology headline today? Search the web for it.” when you allow it." Allow on the phone: the line read "Let it browse the web? · Allowed · it carries on", the bot worked again and answered with a headline. The request stood once in the chat, on the phone and on the web page.
- **A1, A16 (web page, desktop width).** The Chief was asked for a bot that reads the tech news and to start it today. Its card stood under its reply in that chat: "Let Tech Scout browse the web?", "What it may do: browse the web", "The Chief carries on in this chat when you allow it.", Decline and Allow. After Allow, with no message, the Chief started Tech Scout and reported its three stories.
- **The browser test** `test/browser/carries-on.cjs`, by hand, at phone and desktop width on stand-in asks: the Chief's card and its words in Needs you, the rows of a connected-app action, a closed card of five rows, the too-long card, "Waiting for your OK", a run that carries on.
- **Both gates** on `54c64fe`: the full gate (the real registry install) and the resilience gate (the Android build, 268 unit tests, lint).
- **Not walked:** a connected app (A7 to A9); a decline; a busy bot and a restart (A12, A13); a teammate's and a job's run (A5, A6); the Chief's card and a connected-app card on Android; an older app (A19).

## The owner's checklist

In journey order. Each step: what to do, then what you should see. Steps 1 to 4 need about ten minutes.

1. **A new bot (A1, A16).** Ask the Chief: "Make me a bot that checks the weather in Brussels every morning and tells me. It needs the web. Start it today." *The card is under the Chief's reply: "Let … browse the web?", "The Chief carries on in this chat when you allow it.", Allow. After Allow you type nothing: the Chief starts the bot and says so.* On the web page or in the Android app.
2. **A permission in the middle (A2).** Open Headline Bot and ask: "List the files in your folder with a command." *It says it may not run commands; the card says "It carries on with “…” when you allow it." After Allow: "Allowed · it carries on", then its answer. Your request is in the chat once.*
3. **From the phone (A18).** Do step 2 with another bot and press Allow in the notification. *The answer arrives as the next notification.*
4. **Asked again (A10, your decision of 2026-10-06).** Ask a bot without web access for a headline, do not allow; ask it for the weather instead. *One card; it names the weather request. Allow: only the weather request carries on.* Then the other half: ask for a headline, do not allow, ask "what is 2 + 2", and allow. *Nothing carries on: the bot answered your later message.*
5. **Decline (A14).** Ask the Chief for another bot that needs the web and press Decline. *A line "Declined: web access for …" in the Chief's chat; no reply follows.*
6. **One card (A15).** Ask the Chief for a bot that needs the web, do not allow, and send that bot a request that needs the web. *Still one card. Allow: the Chief carries on, and the bot carries on with your request.*
7. **A paused bot (your decision of 2026-10-06).** Switch off every job of Tech Scout, ask it to run a command, allow. *It carries on with your request.*
8. **Busy (A12).** Allow a card while that bot is working on something else. *"Allowed · it carries on when it is free", and it starts by itself.*
9. **A connected app (A7, A17), where you have one connected.** Ask a bot to send you an email. *Its line reads "Waiting for your OK"; the card shows To, Subject, Text as rows; "Allow once" lets the same run send it.* Open the card: *every value is there in full.*
10. **A late OK (A8, A9).** Ask again and wait more than ten minutes. *The bot says it is not sent and the card stays, "… stopped waiting at …". "Allow once" starts the bot again and the email is sent once.*

Failure cases to try: botdot stopped and started between Allow and the bot's turn while the bot is busy (*it still starts, once*); Allow on the web page and on the phone at the same moment (*one run*); a bot deleted while its card waits (*the card goes*).

## What cannot be tested by hand

- 24 hours on a card, and a card that goes after a day: tests only.
- A one-use grant across a restart, and a grant that goes unused with its run: tests only.
- An action with more than 200 arguments: `node --test test/connector-wait.test.js` shows the too-long card's refusal.
- An app from Milestone 5 against this server (A19): not run.

## Scenarios

| Scenario | Checklist step, or the test that holds it |
| --- | --- |
| A1 | Step 1; `test/chief-carries-on.test.js` |
| A2 | Step 2; `test/ask-carries-on.test.js` |
| A3 | `test/ask-carries-on.test.js` (a skill, against a stand-in for GitHub) |
| A4 | `test/ask-carries-on-starters.test.js`, `test/chief-carries-on.test.js` |
| A5, A6 | `test/ask-carries-on-starters.test.js` |
| A7, A8 | Steps 9 and 10; `test/connector-wait.test.js` |
| A9 | Step 10; `test/connector-late.test.js` |
| A10 | Step 4; `test/ask-carries-on-rules.test.js` |
| A11 | `test/ask-carries-on.test.js` |
| A12 | Step 8; `test/ask-carries-on-queue.test.js`, `test/chief-waiting-turns.test.js` |
| A13 | `test/ask-carries-on-queue.test.js`, `test/chief-waiting-turns.test.js` |
| A14 | Step 5; `test/chief-carries-on.test.js` |
| A15 | Step 6; `test/one-card.test.js` |
| A16 | Step 1; `test/bot-change-card-web.test.js`, `ui/ChiefChatNeedsTest` |
| A17 | Step 9; `test/connector-card-web.test.js`, `ui/ConnectorCardTest`, `test/needs-text.test.js` |
| A18 | Step 3 |
| A19 | Not run: see "What cannot be relied on" |
| A20 | Real use, below |

## Real use (A20)

On the owner's own botdot server and phone, after the update: steps 1 and 2, and step 9 with an app the owner has connected.

## Acceptance

The owner accepted the milestone on 2026-10-06 ("approved"), on commit `94bae49` (runtime as of `54c64fe`), and asked for the pull request. The owner was told beforehand what the agent had not walked ("What was walked before handing over") and what cannot be relied on, among them that no connected app was available (A7 to A9 rest on stand-ins) and that an older Android app was not run (A19). Real use (A20) on the owner's own server and phone is left for after the merge.
