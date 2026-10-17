# Milestone 7 test: busy and stopped

Test document of [Milestone 7](milestone7.md), written by the acceptance task BUSY-007.

## Review

The milestone review ran on the diff from main, by the `kordal-reviewer` agent (Claude Opus 5.5). Every finding was checked against the code before it was acted on.

| Pass | Reviewed | Result |
| --- | --- | --- |
| 1 | `main...b6f6c37`, BUSY-001 to BUSY-006 and BUSY-008, once per axis | No high. Three medium, twelve low |
| 2 | `fe605cb...291b4f6`, the fix task BUSY-009 only, both axes by one reviewer | No high. One medium, five low |
| 3 | `291b4f6...f84c076`, the fix task BUSY-010 only, both axes by one reviewer | No high. Two medium, five low |
| 4 | `f84c076...17f4a5c`, the fix task BUSY-011 only: its task review by `kordal-task-reviewer`, both axes; no further milestone pass | No high or medium. Three low |

The security questions of pass 1 came back clean: only the owner takes a message back, stops a Chief chat or signs Claude out; the Chief can take away only a run it asked for; a bot reaches none of these routes; no failure the owner must hear is made quiet by mistake; text from the server, a bot or the owner is drawn as text in both apps.

Medium findings of pass 1, all fixed in BUSY-009:

1. **"Could not tell" was sent as "signed out"** (both axes; capability 14, B21). A sign-in check that failed or timed out, or a botdot without Claude Code, made both apps show the signed-out line and the phone ring while jobs ran. Fixed: an unknown answer sends nothing and changes nothing.
2. **Unreadable output of the check counted as signed out** (Spec; capabilities 1 and 14): no job started and every bot's waiting messages were held. Fixed: it is an error, which is "could not tell".
3. **Stop in a Chief chat did not follow a script job** the Chief had started (Spec; capability 7, B14). Fixed: the script is ended, its run reads the owner's sentence, and no AI follow-up runs.

BUSY-009 also took three low findings along: a message kept in memory after the queue file could not be written; the owner's waiting messages for the Chief starting and failing while Claude was signed out; stale lines in ADR 011 and ADR 012.

The medium finding of pass 2, fixed in BUSY-010: an app that connected while the sign-in check could not tell heard nothing, also while botdot still held jobs and messages as signed out. BUSY-010 took three low findings of that pass along.

**The two medium findings of pass 3**, put to the owner, who decided on 2026-10-06: "fix them". Fixed in BUSY-011. Both are in capability 14, which the scope lets give way first, and both need the sign-in check to fail at the very moment of a sign-in or a sign-out:

1. **Android says "Signed in to Claude" after a sign-in the server could not check.** Since BUSY-010 the server answers such a sign-in with the check's error where it used to refuse; the web page shows that sentence, Android ignores it.
2. **Apps already open hear nothing after a sign-out whose check could not tell.** botdot holds jobs and messages, and the page that signed out shows no line until a check can tell or the app connects again.

### What cannot be relied on

- **What the Chief and the bots do once started.** The tests show what botdot starts, in which order and with which words, against a stand-in for Claude. Four walks with real Claude went well (below). A Chief that does not end its reply when told the owner wrote, or a long late turn, would show only in use.
- **60 minutes.** No test and no walk waits it out; tests set the limit to a second or two.
- **Quiet hours and the morning line** were not walked: tests hand the clock in.
- **A signed-out Claude** was not walked: signing this Mac's Claude out would have ended the session that ran the acceptance. Tests use a stand-in for the sign-in check. On this Mac the real `claude auth status --json` prints JSON when signed in; what it answers when signed out, when the sign-in has expired, or in the Docker image, was not checked.
- **An Android app from Milestone 6 against this server** (B22) was not run. By reading: its model of a run needs only `id`, which a queued answer has.
- **Android's jobs screen, the signed-out line and notification, and a late result's files** were not seen on the emulator: unit tests hold their words and data.
- **The web page at desktop width** was seen by the owner at the first look for a bot's chat only.
- **The browser walk** `test/browser/message-waits.cjs` was not run: the repository does not carry Playwright.
- **Unstable tests.** Three were found and fixed during this milestone: `test/one-time-queued.test.js` (BUSY-001), `test/connector-wait.test.js` (BUSY-002) and `test/chief-late.test.js` (BUSY-009). The task gate ran between 1:45 and 2:41 of its 3:00.

### Follow-up

Low findings and open points, for the owner to decide; none is fixed.

Behaviour:

- A job that fails and works in turn through the night gets one morning line per row of failures, not one for the night.
- An AI job whose time comes while it already waits for its bot merges with the waiting one and leaves no line.
- Times on a job's line and in the morning line are in the server's time zone, the one schedules follow; quiet hours can have another.
- A run that a sign-out ended reaches the Chief's chat as the bot's own message, not as a turn of the Chief: a turn would fail while signed out. Each run of the owner's that was going at a sign-out is told as failed.
- When the server knew "signed out" and the next check cannot tell, an app that connects in that minute shows no line until a check can tell.
- A message sent to a free bot, and a memory review, still start and fail while Claude is signed out.
- Deleting a bot with messages waiting takes several steps: Stop starts the next message, and a bot with a run going cannot be deleted.
- Stop does not follow a hand-off to a teammate, nor a run an earlier reply of the Chief started (agreed exclusions). A `run_job` call that arrives after Stop while the reply is ending is not covered by a test.
- The owner's waiting message for the Chief has no 24-hour limit; botdot's own waiting turns have one.
- The final reply of a bot that waited for its teammates, and a run that ends asking for the owner's OK, now also reach the Chief as a turn.
- On Android the signed-out line and notification show only against a server that names a Milestone 7 feature, and a tap on the notification opens the app where it was, not Settings.
- On Android the working lines end in "…" and the line with Stop is higher than one without; a 10 dp gap above the Chief's line was not looked at.
- The web page colours a stopped or cut-off job's line as a warning; Android draws it faint.
- "Saved." under a job on the web page stands for 2.5 seconds, then the job's line returns.
- The signed-out sentence beside the logo wraps to two lines at 1280 pixels.
- A row of failures outlives a repair of the job: a repaired job that fails again is quiet.
- Work dropped from the queue keeps its own sentence on a line that begins "Last run … failed."

Documents and tests:

- A waiting message has two shapes, one in `lib/bots.js` and one in `lib/chief.js`: other names for the same fields, the limit and two helpers written twice.
- The web page keeps a copy of the four "who ended it" sentences, "60 minutes" included, for a run without the server's sentence.
- `CONTEXT.md` has no entry for a message that waits, take back, a job's row or a late result.
- The wait route in `server.js` declares a second `chiefChat` inside the first one's scope.
- `docs/product/milestone7.md` still says "Seven tasks": BUSY-008 and BUSY-009 were added during delivery and are named under it.
- B8's "end of the wait" has no test of its own.
- Android's `FailedSendTest` still uses "The Chief is still replying" as its example of a refusal; the server no longer says it.
- The second and third review passes were one reviewer for both axes, not one per axis.
- The sign-out route's refusal for a botdot without Claude Code has no test; its two sentences are written twice; a `CLAUDE_BIN` that points at nothing passes it and leaves a hold nothing ends; a sign-out that fails while the check cannot tell can leave botdot holding though Claude is signed in.
- Android still says "Signed out of Claude" after a sign-out whose answer carries an error; the web page shows the sentence.
- Setup's "done" is enabled when the sign-in check could not tell.
- Android's Setup still reads `loggedIn` beside an `error`; the Android notifier does not filter replayed `claude` events.
- `drainQueue` loses an item when the queue file cannot be written.
- The task gate took 2:54 of its 3:00 once (BUSY-010); the test suite alone is about 2:30 on this Mac.

## How to start it

From branch `task/busy-007`:

- **The botdot server:** a test server on this Mac with its own data folder (`.test-data`, given as a full path), started by the agent: http://localhost:4801. It uses the Claude sign-in of this Mac. It has four bots from the walks: News Reader, Headline Bot, Tech Scout and Weather Bot. Weather Bot has a job "Disk check", a script that fails every minute, switched off: switch it on in the bot's jobs for step 7.
- **Android:** the emulator (Medium_Phone) with the debug app built from this branch, connected to that server through `adb reverse tcp:4801 tcp:4801`. The debug build for a real phone is `android/app/build/outputs/apk/debug/app-debug.apk`.
- For a phone on the tailnet, say "serve" and the agent starts Tailscale Serve for port 4801.

## What was walked before handing over

On 2026-10-06, on the test server, with real Claude:

- **B1, B2, B13 (web page's server, by its API; the page at the first look).** A second message to a working News Reader was answered as queued and listed; take back returned its text; sent again, then Stop on the run: the run read "You stopped this run before it finished." and the waiting message started at once.
- **B10, B11.** The Chief was asked to have Tech Scout find five stories and to wait. While it waited, "Meanwhile: what is 12 times 12?" was sent: the Chief closed its turn with "Tech Scout is still working on the five stories; its answer will come to this chat…", answered "144", and when Tech Scout finished, wrote a short turn with the chip "From Tech Scout".
- **B14, B15.** The Chief was asked to have Headline Bot find ten headlines; Stop in the Chief's chat: the reply read "You stopped this reply. Headline Bot's run was stopped too.", and the run was stopped with the owner's sentence.
- **B18, in part.** Weather Bot's "Disk check" failed twice in a row: the first failure counted as new, the second was quiet, and the job's line read "Last run at 18:45: failed, 2 times in a row since 18:44. …". A third failure was not waited for.
- **B3, B12, B13 (Android, emulator).** In News Reader's chat with a run going, the box had Send and the line ended in Stop; a typed message stood faded with "Waits until News Reader is free" and "Take back"; Stop ended the run with "You stopped this run before it finished." and the message started.
- **Both gates** on `8dc4b44`, and again on `57322c9` with BUSY-011: the full gate (the real registry install) and the resilience gate (the Android build, unit tests, lint).
- **Not walked:** a restart with a message waiting (B6); the eleventh message (B5); a held bot (B8); a tile and `run_bot` on a busy bot (B7); the limit (B17); quiet hours (B19); why a job did not run (B20); a signed-out Claude (B21); an older app (B22); a late result with a file; the fixes of BUSY-009 and BUSY-010 on a screen.

## The owner's checklist

In journey order. Each step: what to do, then what you should see. Steps 1 to 5 need about ten minutes.

1. **Write while a bot works (B1, B3, B12).** Give News Reader a longer task ("Search the web for three of today's technology headlines and write two sentences about each."), and send a second message while it works. *Send stays in the box. The second message stands faded under the working line: "Waits until News Reader is free · Take back". When the first answer is there it starts by itself.* On the web page and in the Android app; the message shows on both.
2. **Take back (B2).** Do step 1 and tap "Take back". *The text is in the box again and nothing waits.*
3. **Stop, then your message (B13, B15).** Do step 1 and tap Stop at the end of the working line. *"You stopped this run before it finished.", and your waiting message starts at once.*
4. **The Chief while it waits (B9, B10, B11).** Ask the Chief: "Ask Tech Scout for the five most important technology stories of this week, three sentences each. Wait for its answer." While its line reads "Waiting for Tech Scout", send "Meanwhile: what is 12 times 12?". *Your message stands faded, the Chief ends its reply in one line, answers yours, and later writes a short reply with "↩ From Tech Scout".*
5. **Stop in the Chief's chat (B14).** Ask the Chief the same of Headline Bot and tap Stop on the Chief's line. *"You stopped this reply. Headline Bot's run was stopped too." Headline Bot's chat says you stopped its run.*
6. **The Chief stops a run (B15).** Give a bot a long task, then ask the Chief to stop that bot's run. *The run reads "The Chief stopped this run before it finished."*
7. **A job that keeps failing (B18, B20).** Open Weather Bot's jobs and switch "Disk check" on; wait three minutes. *One failed run with a dot, then none: the job's line counts "failed, 3 times in a row since …". Switch it off again.*
8. **Why it did not run (B20).** Give a bot a job for the next minute, ask the agent to stop the test server over that minute and start it again. *The job's line reads "Did not run at …: botdot was off."*
9. **A restart (B6).** With a message waiting behind a working bot, ask the agent to restart the test server. *The first run says it was cut off; the waiting message starts, once.*
10. **Stop and a script (BUSY-009).** Ask the Chief to run a script job that takes a while (a job whose script is `sleep 120`), and tap Stop on the Chief's line. *The bot's chat shows the run as stopped by you; no AI reply follows.*

Failure cases to try: eleven messages to one working bot (*the eleventh stays in the box with "… already has 10 of your messages waiting"*); "Take back" at the moment the first run ends (*"It has already started."*); the same message from the web page and the phone at once (*it waits once*).

## What cannot be tested by hand

- 60 minutes: `node --test test/run-limit.test.js` shows the limit with a short one.
- Quiet hours and the morning line: `node --test test/job-row.test.js`. To see it, ask the Chief to set quiet hours over the present hour, do step 7, then end quiet hours.
- A signed-out Claude on this Mac ends the agent's own session; on your own server it is step B21 of real use. Tests: `test/job-missed.test.js`, `test/claude-could-not-tell.test.js`.
- An Android app from Milestone 6 against this server (B22): not run.

## Scenarios

| Scenario | Checklist step, or the test that holds it |
| --- | --- |
| B1 | Step 1; `test/message-waits.test.js` |
| B2 | Step 2; `test/message-waits.test.js`, `test/message-waits-web.test.js`, `ui/MessageWaitsTest` |
| B3 | Step 1; `test/message-waits.test.js`, `test/chief-message-waits.test.js` |
| B4 | `test/message-waits.test.js`, `test/message-waits-unit.test.js` |
| B5 | `test/message-waits.test.js`, `test/chief-message-waits.test.js` |
| B6 | Step 9; `test/message-waits.test.js`, `test/chief-message-waits.test.js` |
| B7 | `test/message-waits.test.js` |
| B8 | `test/connector-wait.test.js` |
| B9 | Step 4; `test/chief-message-waits.test.js`, `test/message-key.test.js` |
| B10 | Step 4; `test/chief-message-waits.test.js` |
| B11 | Step 4; `test/chief-late.test.js`, `test/chief-files-web.test.js` |
| B12 | Steps 1 and 4; `test/chief-line-web.test.js`, `ui/StopLineTest` |
| B13 | Step 3; `test/ended-by.test.js`, `test/chief-stop.test.js` |
| B14 | Steps 5 and 10; `test/chief-stop.test.js` |
| B15 | Steps 3, 5 and 6; `test/ended-by.test.js`, `test/run-limit.test.js` |
| B16 | `test/ended-by.test.js`, `test/run-limit.test.js` |
| B17 | `test/run-limit.test.js` |
| B18 | Step 7; `test/job-row.test.js` |
| B19 | `test/job-row.test.js` |
| B20 | Steps 7 and 8; `test/job-missed.test.js`, `test/job-line-web.test.js`, `ui/JobLineTest` |
| B21 | `test/job-missed.test.js`, `test/claude-could-not-tell.test.js`, `test/signed-out-web.test.js`, `feed/SignedOutNotifierTest` |
| B22 | Not run: see "What cannot be relied on"; `data/QueuedAnswerTest` |
| B23 | Real use, below |

## Real use (B23)

On the owner's own botdot server and phone, after the update: steps 1, 4 and 5, and once a sign-out of Claude with a job due (B21).

## Acceptance

The owner accepted the milestone on 2026-10-06 ("accepted and fix them"), on commit `4803a87` (runtime as of `8dc4b44`), and asked for the two medium findings of the third review pass to be fixed. The owner was told beforehand what the agent had not walked and what cannot be relied on, among them that a signed-out Claude, quiet hours, the 60-minute limit and an older Android app rest on tests only. BUSY-011 is that fix, on `57322c9`: a runtime change after the owner's test, in the handling of a sign-in check that fails at the moment of a sign-in or a sign-out, which only a test's stand-in can produce.

The owner approved BUSY-011 on 2026-10-06 ("Approved"), on commit `6ef9b3e` (runtime as of `57322c9`), told that it rests on `test/claude-could-not-tell.test.js` and Android's `ClaudeSignInTest`. Real use (B23) on the owner's own server and phone is left for after the merge.
