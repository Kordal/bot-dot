# Milestone 5 test: the quick wins of the interaction audit

Test document of [Milestone 5](milestone5.md), written by the acceptance task QW-005.

## Review

The milestone review ran on the diff from main, by the `kordal-reviewer` agent (Opus 5.5), once per axis each time.

| Pass | Reviewed | Result |
| --- | --- | --- |
| 1 | `main...782a560`, QW-001 to QW-004 and QW-006 | One high, one medium, eleven low |
| 2 | `85bc83c...e58b455`, the fix tasks QW-007 and QW-008 only | No high. Two medium, five low |
| 3 | `2906543...46ee2f1`, the fix task QW-009 only | No high. One medium, five low |
| 4 | `85ab51e...538c5ea`, the fix task QW-010 only | No high or medium. Six low |

High and medium findings, all fixed:

1. **A one-time job that came due while its bot was busy never ran** (Spec, high; capability 9, A13). It was queued, removed from the bot's jobs and then dropped; the owner was told nothing. Older than this milestone. Fixed in QW-007: it waits its turn, runs, and its reply reaches the owner.
2. **The web page and Android worded a send that got no answer differently, and a resend could run the task twice** (Standards, medium; capability 1). Decided by the owner on 2026-10-05 and fixed in QW-008: every message carries a key, botdot takes a key once for 24 hours, and both apps say "Not sent: can't reach botdot."
3. **A waiting one-time job that was switched off, moved to a later time and switched on ran within a minute** (Standards, medium). Fixed in QW-009: a retry belongs to the time it came due for.
4. **A one-time script job that hands its output to the AI lost the AI's reply** (Spec, medium; A13). Older than this milestone. Fixed in QW-009.
5. **After an update, a retry kept by the older botdot ran a job that had been moved to a later time at once** (Standards, medium, confirmed by the reviewer's experiment). Fixed in QW-010.

One more change came from the owner's first look, not from the review: QW-006, "Not sent" where Tailscale Serve answers for a stopped botdot.

### What cannot be relied on

- **What the Chief and the bots say.** Capabilities 6, 9 (which job gets notify "always"), 11 and 12 are instructions. The tests show what they are told, against a stand-in for Claude; that a model follows it is the owner's part of the checklist.
- **An Android app from before this milestone** loses its yes button on a changed bot and a connected-app action at once, and keeps Approve on script jobs and tiles until it is updated. No older build was run against this server: A19 rests on reading the code.
- **The key of a message** is not sent with a plan's Approve in Needs you or with a reply from a notification; those can still be delivered twice.
- **On the emulator a failed send read "It may have been sent"** before QW-008, because its tunnel to this Mac accepts a connection and then drops it. On a phone through Tailscale Serve the answer is a 502. Neither was walked on a real phone by the agent.

### Follow-up

Low findings, for the owner to decide; none is fixed.

Behaviour:

- A one-time script job whose hand-over to the AI meets a full queue (ten items waiting) loses the AI's look; "Run now" of a one-time script job can lose it too.
- A one-time job whose minute passes while it is switched off or not approved, without having waited, does not run when switched on.
- A retry entry from the older botdot on a job moved to a time that has since passed more than a day ago runs when the job is switched on.
- Three bots waiting for each other in a ring end only at the timeout; a teammate that works over an hour is no longer waited for.
- The recall index still calls a failed Chief reply with text a success.
- `run_job` still hands the Chief a `costUsd` key, and the description of a bot's computer still says "costs more per run".
- The chip says "web access waits for your OK" where the notification of the same thing says "wants to change what it may do": two vocabularies.
- An app's name in a notification's line can differ before and after the catalogue is loaded ("Googlecalendar", "Google Calendar").
- A bot's message that fails after the owner left that chat is said in a toast, where the plan said no toast.
- A failed file upload still shows the browser's own words.
- A failed reply can still show terminal colour codes from Claude Code.

Tests and tooling:

- The web page ignores the new `scripts` field of a waiting tile and gathers the scripts itself; Android keeps a third copy as its fallback.
- No test proves that a failed write of the queue file leaves the other jobs of that minute running; it was seen once by hand.
- The full-queue test depends on the clock in about one run in six and then proves less.
- Four repeating-job tests still wait a real minute; they set the task gate's time (about two minutes of its three).
- One task gate run failed once and passed when repeated unchanged; its output was not kept.
- The Android message box has no test of its own; the outbox behind it has.
- `make android-test` and `make android-lint` need `JAVA_HOME` and `ANDROID_HOME` set by hand on this Mac.
- The browser test `test/browser/failed-send.cjs` runs in no gate and was not run: the repository does not carry Playwright.

## How to start it

From branch `task/qw-005` at the commit of this document:

- **The botdot server:** a test server on this Mac with its own data folder, started by the agent: http://localhost:4801 on this Mac, and https://mac.example.ts.net:4801 from a phone on the tailnet. It has no bots and no Claude sign-in: open Setup and sign in once to try what the Chief does.
- **Android:** the emulator (Medium_Phone) with the debug app built from this branch, on that server through `adb reverse tcp:4801 tcp:4801`. The debug build for a real phone is `android/app/build/outputs/apk/debug/app-debug.apk`.
- To stop and start the server for the failed-send steps, tell the agent "stop" and "start".

## What was walked before handing over

On 2026-10-05, on the test server, without a Claude sign-in:

- **A1, A4 (web):** at desktop and phone width, with the server stopped: the message was back in the box under "Not sent: can't reach botdot. Your message is still here.", no bubble was added, no toast showed, and "Can't reach botdot" stood beside the logo.
- **A1 (web, through Tailscale Serve):** the owner's first look, on their phone: the message came back; the line's wording was changed by QW-006 afterwards.
- **A1 (Android, emulator):** the message came back into the box; the line read "It may have been sent" (before QW-008; see "What cannot be relied on").
- Both gates on the last commit: the full gate (the real registry install) and the resilience gate (the Android build, 225 unit tests, lint).
- Not walked: everything that needs the Chief or a bot to answer (A5 to A14, A17, A18), and an older Android build (A19).

## The owner's checklist

In journey order. Each step: what to do, then what you should see.

1. **A failed send (A1).** Type a message to the Chief with a file attached, say "stop", press Send. *The text and the file are back in the box under "Not sent: can't reach botdot. Your message is still here." Nothing new is in the chat.* Do it on the web page and in the Android app.
2. **Sent once (A1, QW-008).** Say "start", press Send again. *The message is in the chat once.*
3. **Away (A4).** With the server stopped, on the web page: *"Can't reach botdot" beside the logo, or above the box on a phone; no red message repeats.* It goes when the server is back.
4. **A quick answer (A3).** When the Chief or a bot offers answer buttons, say "stop" and tap one. *The buttons are still there.*
5. **A bot that needs the web (A9).** Ask the Chief for a bot that reads the news every morning. *It does not ask "shall I?"; its chip reads "Created <name> · web access waits for your OK", and its reply says the card waits.*
6. **The phone (A5).** With that card waiting: *the notification says what the Chief wants to change and has Decline only; a tap opens the card.* Ask a bot to add a script job: *"Wants to add a script: <name>, <when>", Decline only.* A permission asked by a bot keeps Allow.
7. **A tile's card (A6).** Have the Chief put a tile with a script on the Board. *The card on Android shows the script.*
8. **A failed reply (A7).** Stop a Chief reply after it started writing. *The text stays, with "You stopped this reply." under it.*
9. **A deleted bot (A10).** Have the Chief delete a bot. *The chip names it.*
10. **Notes with learning off (A8).** Switch a bot's learning off, pin a note for it, ask it something the note answers. *It answers from the note.*
11. **A hand-off (A11).** Ask a bot for something a teammate must do. *The first bot comes back with the result, or says what the teammate did not deliver.*
12. **Reports (A13).** Ask the Chief: "send me the news every morning" and "have <bot> check <something> in two minutes". *The one-time reply arrives, also if it says there is nothing new. The morning job has notify "always" (ask the Chief).*
13. **Questions (A15, A16).** On the web page: remove a group, undo a bot's change, delete a note: *no question.* Send "my password is wrong again": *no warning.* Choose "bypassPermissions" in a bot's exact permissions: *the question comes; Cancel puts it back.*
14. **No cost words (A17).** Ask the Chief for a scheduled check. *It says what it checks and how often, and never "free".*

Failure cases to try: a message sent while the Chief still replies from the other app (*back in the box with "The Chief is still replying."*); a teammate that fails (*the first bot says so*); a one-time job due while its bot is busy (*it runs when the bot is free*).

## What cannot be tested by hand

- An update from today's botdot with a retry kept in its queue file (QW-010): tests only.
- Twenty-four hours of a message key, and a key across a restart: tests only.
- An older Android build against this server (A19): not walked.

## Real use (A20)

On the owner's own botdot server and phone, after the update: a message sent while botdot is stopped comes back and is sent once; a changed bot's notification has no yes and opens its card; a job the Chief adds for "send me … every morning" delivers its first reply.

## Acceptance

The owner accepted the milestone on 2026-10-05 ("Approved"), after testing a failed send from their phone through Tailscale Serve on the test server, on commit `5b50b46` (runtime as of `538c5ea`). The owner was told beforehand what the agent had not walked ("What was walked before handing over") and that real use (A20) needs the milestone on their own server; A20 is left for after the merge.
