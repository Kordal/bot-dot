# Feature test: a job's schedule in plain words

Test document of the feature "job schedule in words" ([its record](milestone4.md#added-features)), written by its last task, SCHED-003. The tasks: SCHED-001 (server and web page), SCHED-002 (Android), SCHED-003 (the Mac and this acceptance). It comes from the improvement report [Job schedules in plain words](improvements/2026-10-04-job-schedule-in-plain-words.md).

## Review

The whole feature, the diff from main, was reviewed by the `kordal-reviewer` agent (Claude Opus 5.5), once per axis, on `466448b`. Nothing the feature introduces was graded above low.

1. **High, older than the feature: a schedule could stop the server** (Standards, run by the reviewer). A field such as `Infinity` never left the parser's loop in `lib/cron.js`, and `0-16000000` took 2.3 seconds and 545 MB. A bot or the Chief reaches it by adding a job, the owner by typing it. Fixed in `54c9d1e`, outside the plans' scope: a field is refused at its first value out of range; `test/cron.test.js` pins that, and that what was taken or refused before still is, with the same words.
2. **Low: the Mac and the web page disagreed when the server could not be asked** (Standards). The Mac changed the words beside the name to its own ("Custom schedule"). Fixed in `889a8a5`: the words stay, as on the page.
3. **Low: the server had two definitions of a bot's jobs as the routes hand them out** (Standards). Fixed in `889a8a5`.
4. **Low: three departures of the Mac from its plan's letter** (Spec). Recorded in SCHED-003's Completion Notes; the words shown are the same.
5. **Low, kept: a fallback in `Cron.listed` that the view never reaches** (Standards). The function takes any text, so it answers for any.

The fixes were not reviewed again; both gates cover them.

### What cannot be relied on

- **An app from before this feature** still shows the cron for a schedule it does not know.
- **A server from before this feature** sends no words. Android and the Mac then say ten common shapes themselves and "Custom schedule" for the rest: `0 8-21 * * *` reads "Custom schedule" there, not "Every hour, 08:00 to 21:00".
- **The words are in the server's time zone**, as the schedule is.

### Follow-up

Low findings and things seen on the walk, for the owner to decide; none is fixed.

- **The Mac raises an alert while a schedule is typed.** The editor saves a moment after each change, the server refuses an unfinished schedule, and the Mac shows the refusal as an alert ('Job "Odd minutes": Cron needs 5 fields…'). Older than this feature; the web page shows the refusal under the field only.
- **Cron's own words stay in the editor**: the hint "cron: min hour day month weekday" and the refusals ("Cron needs 5 fields", "Bad cron field"). Editing without cron was not chosen for this feature.
- **An open job card keeps the words it loaded with** when the Chief or a bot changes that job meanwhile, on the web page and the Mac. Older than this feature; it never shows cron.
- **Time of day is written three ways**: the words say "08:00", the web page's pill "next 02:00 PM", Android and the Mac "next 14:00". Not chosen for this feature.
- **`lib/cron.js` still takes fields no schedule needs**, such as the step `1.5`.
- **Android:** `describeCron` and `scheduleWords` live in a screen's file; a file of their own in `data/` would suit them.
- **A flaky test of the Mac suite:** `aRatingIsStoredClearedAndMoved` (the Chief's chat) failed once in a full run and passed alone and in the four runs after it. It does not touch this feature.

## How to start it

It is running on this Mac, from branch `task/sched-003`:

- **The botdot server:** the test server of `.claude/launch.json` (`bot-dot-test`), data in the ignored `.test-data/`: http://localhost:4801. One bot, Mail Watcher, with 14 jobs. They are scripts that do nothing, so they run quietly; Claude is not signed in there. "Disk check" waits for an OK, "Office hours sync" is always approved.
- **Android:** the emulator (Medium_Phone) with the debug app built from this branch, connected to that server.
- **Mac:** a Debug build with its own bundle identifier (`dev.botdot.mac.schedtest`), on that server. The installed botdot app is untouched.

To start it again: `bot-dot-test` from `.claude/launch.json`; `~/Library/Android/sdk/emulator/emulator -avd Medium_Phone`, then `adb reverse tcp:4801 tcp:4801` and the address `http://localhost:4801` in the app; `open -n macos/build/schedtest/Build/Products/Debug/botdot.app --args -botdot.server http://localhost:4801`.

The 14 jobs and what each must read:

| Job | Words |
| --- | --- |
| Hourly inbox check | Every hour, 08:00 to 21:00 |
| Morning news | Daily at 09:00 |
| Weekday briefing | Weekdays at 07:30 |
| Uptime ping | Every 15 min |
| Deal scan | Every 2 hours |
| Meal reminder | Daily at 08:00, 12:00 and 18:00 |
| Office hours sync | Every 30 min, 09:00 to 17:30, Monday to Friday |
| Gym days | Mondays, Wednesdays and Fridays at 09:00 |
| Monthly report | Monthly on day 1 at 09:00 |
| Quarter-past check | Hourly, at minute 15 |
| Weekly review | Sundays at 20:00 |
| Odd minutes | Custom schedule |
| Impossible date | Never runs |
| Disk check | Daily at 08:00, 12:00 and 18:00 |

## What was walked before handing over

- **Gates:** see [Acceptance](#acceptance).
- **The web page:** "Waiting for your OK", then the dialog "Approve this job?" with "Disk check · Daily at 08:00, 12:00 and 18:00"; Approve, and the toast "Approved. Disk check: Daily at 08:00, 12:00 and 18:00." (the job was then set back to waiting). The jobs list: all 14 rows as in the table, "next Nov 1" on Monthly report, no pill on Impossible date. In the card of Odd minutes, typed in turn: `foo` (header "Invalid schedule", the refusal in red under the field), `0 0 31 2 *` ("Never runs" in both), `*/20 9-17 * * 1-5` ("Every 20 min, 09:00 to 17:40, Monday to Friday" with three next runs), `5-50/7 * * * *` ("Custom schedule" with three next runs). In the bot's settings, "Always approved" opened: "Every 30 min, 09:00 to 17:30, Monday to Friday · a script, no AI" under Office hours sync.
- **Android**, on the emulator: the Needs-you card of Disk check, read from the screen's text since that screen cannot be captured: "Daily at 08:00, 12:00 and 18:00 · a script, no AI · added by the Chief". The jobs list: all 14 rows as in the table, "Next: 1 Nov, 09:00" on Monthly report, "Waits for your OK" on Disk check.
- **The Mac**, in the Debug build: the Needs-you card with the same line as Android. The jobs list: all 14 rows as in the table, "next 1 Nov" on Monthly report. In the card of Odd minutes, typed in turn: `foo` ("Invalid schedule", the refusal in red, and the alert of the Follow-up), `0 0 31 2 *` ("Never runs"), `0 8-21 * * *` ("Every hour, 08:00 to 21:00. Next: …"), `5-50/7 * * * *` ("Custom schedule. Next: …").
- **Not walked:** the always-approved list in the bot's settings, opened, on Android and the Mac (the Mac's closed row was seen; the tests hold the line's words). The Android app on the emulator was built from `466448b`; the two commits after it change no Android file. A server from before this feature (the tests cover a job and a preview without words). The Chief or a bot setting a schedule in a chat: the test server has no Claude sign-in.

## Checklist

On the web page (http://localhost:4801: Mail Watcher, its name at the top, "Scheduled jobs"), then the same on Android and the Mac.

1. [ ] The jobs list shows every job's words as in the table above, and no cron anywhere beside a name.
2. [ ] Monthly report's "next" shows the date (1 Nov), not a weekday.
3. [ ] "Needs you" (web: "Waiting for your OK", Review) shows Disk check with "Daily at 08:00, 12:00 and 18:00".
4. [ ] Web page and Mac: open Odd minutes and type `0 8-21 * * *` into Schedule. The words beside the name and the line under the field change to "Every hour, 08:00 to 21:00", with the next runs.
5. [ ] Type `0 0 31 2 *`: "Never runs". Type `foo`: "Invalid schedule" beside the name and the refusal in red under the field. Type `5-50/7 * * * *` again: "Custom schedule".
6. [ ] Pick "Mondays at 10:00" in the "When" list of any job: the words beside the name follow.
7. [ ] Web page: approve Disk check. The toast reads "Approved. Disk check: Daily at 08:00, 12:00 and 18:00."
8. [ ] In Mail Watcher's settings, "Always approved" lists Office hours sync with "Every 30 min, 09:00 to 17:30, Monday to Friday".
9. [ ] On your own botdot, after the update: a job the Chief set on an unusual schedule reads as words on all three.

Failure cases to try: typing fast and stopping mid-schedule (the words must end on what the field holds); on the Mac, the alert of the Follow-up when a typed schedule is refused; stopping the test server while a card is open (the words stay, the reason shows under the field).

## Changes from the owner's test

None yet.

## Acceptance

On 2026-10-04 the owner said the feature passes ("Approved"), tested on commit `889a8a5` (the test server, the emulator and the Mac's Debug build above). Which checklist steps the owner ran was not recorded; step 9 needs the owner's own botdot after the update. The owner named no change to the Follow-up.

Gates on `889a8a5`: task-check passed in 1:31, pr-check in 0:07, premerge-check in 1:55.
