# Milestone 8 test: nothing approved unseen, no question lost

Test document of [Milestone 8](milestone8.md), written by the acceptance task SURE-005.

## Review

The milestone review ran on the diff from main, by the `kordal-reviewer` agent (Claude Opus 5.5). Every finding was checked against the code before it was acted on.

| Pass | Reviewed | Result |
| --- | --- | --- |
| 1 | `main...45a1ec5`, SURE-001 to SURE-004, once per axis | No high. Two medium, eleven low |
| 2 | `0b75f9e...e99c0d5`, the fix task SURE-006 only, both axes by one reviewer | No high or medium. Five low |

The security questions of pass 1 came back clean: only the owner approves a job, a tile or a suggestion; the scheduler, "Run now" and the Chief's `run_job` read only the approved definition of a job; "Approve all" takes no job that runs a script, or would after its change, and no tile, in both apps; a bot's proposal carries on once, and nothing starts after a no.

Medium findings of pass 1, both fixed in SURE-006:

1. **On Android a second change stayed hidden** (Standards). An answered card was remembered by its job alone, so after "Keep as it is" in a bot's chat a newer change to that job had no card until the owner left the chat. Fixed: an answered change is remembered by the change, as on the web page.
2. **A long reply's notification did not say the question** (Spec; C7). The notification's body was the reply's first 300 characters. Fixed: a run that asks carries `question`, the question in one line, and Android shows that.

SURE-006 also took three low findings along: a yes from an out-of-date card on a script job wrote "approved" to the audit log though nothing was approved; Android would have shown a tile's approved scripts as the proposed ones for a change that lists none; the Chief's Board skill did not say that an approved tile keeps working while its changed script waits.

### What cannot be relied on

- **A yes approves the change that waits at that moment.** When a bot changes a job a second time between the card being drawn and the tap, the tap approves the newer change, which the card did not show. The job dialog on the web page reads the job again before its yes; the cards do not. Closing it needs the card to send back which change it answers. Recorded in [ADR 013](../adr/013-a-change-to-an-approved-job-waits-beside-it.md).
- **An Android app from Milestone 7 still approves scripts with its "Approve all"** until it is updated: each app sends one call per job, and the server cannot tell that tap from a yes on a card.
- **A question is a question only when the bot marks it** with answer buttons or a question card. A question in plain prose is a reply like any other.
- **A run the Chief started does not carry on after a bot's own proposal**; the owner's and a teammate's request do. A job the Chief starts with `run_job` is not treated as the Chief's run: its question goes to the owner.
- **"Always approve" on an AI job covers a later change into a script job.** A job with "Always approve" changes at once, as before this milestone, and a bot can make such an AI job a script job with no card and no line in the audit log. Older than this milestone; SURE-006 writes the audit line for script jobs only.
- **The task gate is at its budget.** It took 3:18 of its 3:00 once (SURE-006, with the emulator, a test server and a second gate on the same Mac) and 2:24 to 2:56 otherwise.

### Follow-up

Low findings and open points, for the owner to decide; none is fixed.

Behaviour:

- After the update, a bot whose last reply held an unanswered question shows "Asks" until the owner writes to it; there is no age limit.
- The card's line "It carries on with … when you allow it." says "allow" on a card whose button reads "Approve".
- "Approve N" counts a change in words to an approved AI job; the prototype showed new jobs only.
- A tile with a change waiting has no sign on the Board itself.
- The feed's event `asks` has two forms under one name, told apart by `botId`.

Outside the plans, kept: a "Review the change" button in the jobs list of both apps, and the "?" mark on a pinned bot's figure on Android.

Code and documents:

- The words of a change's card ("Runs as you approved it until you answer.", "<name>: a change", "… runs a script: approve it on its card.") are written once per app, not on the server.
- The bot's chip reads "Changed job X, waiting for your approval" where the Chief's says "Proposed a change to".
- The run field `askedChief` is not in `docs/api.md`.
- Duplicated helpers: `ownersMessage` (`lib/read.js`, `lib/asks.js`), `changeOf` (`server.js`, `public/app.js`), `oneLine` (`lib/choices.js`, `lib/asks.js`); a bot's proposal has three encodings in `lib/asks.js`.
- `job.approved` in the audit log now also means that "Always approve" began on an approved script job; ADR 013 names only the yes of a change.
- `docs/api.md` does not name `always` on the route that answers a job.
- Against a server that sends no `at` on a change, Android would hide a second change as before; every server with `staged-changes` sends it.
- No test opens the dialog before "Always allow this action" on Android; one compares its sentence with the web page's.
- `test/chief-message-waits.test.js` failed once in a hand run under load and passed alone and in every gate.

## How to start it

From branch `task/sure-005`:

- **The botdot server:** a test server on this Mac with its own data folder (`.test-data` of the main checkout, given as a full path), started by the agent: http://localhost:4801. It uses the Claude sign-in of this Mac. It has three bots from the walks: News Watcher, Mail Sorter and Shopper.
- **From a phone or another computer on the tailnet:** https://mac.example.ts.net:4801 (Tailscale Serve; botdot refuses this address from the Mac itself).
- **Android:** the emulator (Medium_Phone) with the debug app built from this branch, connected to that server through `adb reverse tcp:4801 tcp:4801`. The debug build for a real phone is `android/app/build/outputs/apk/debug/app-debug.apk`.

## What was walked before handing over

On 2026-10-07, on the test server, with real Claude:

- **C9, C10, C11 (by the API).** News Watcher was asked to change its approved job "Morning news". The job kept its approved time and text and gained the change; `approve: false` answered "Kept as it was: Daily at 07:00" and removed nothing; asked again, `approve: true` answered "Changed: Daily at 08:00". After that yes the bot was started once more and wrote one line: "Nothing left to do: Morning news is live again at 08:00 with three stories".
- **C15.** Shopper was asked to tell the owner when a price drops; it proposed a daily job and said it waits. After the yes it was started again and closed with "The daily Delhaize milk check is approved and live", and proposed nothing twice.
- **C5, by the clock.** A report-only job of Mail Sorter that asks a question ran at 06:42 and 06:43, in quiet hours: both runs were held, quiet, the job's line "held till morning". At 07:00 both were delivered with `asks`, the bot showed its question, and the phone was told "Mail Sorter asks".
- **C1, C3, C6, C7, C9 on the Android emulator.** The home list read "Asks: Which mailbox should I sort first?" with the "?" mark. Needs you read "Uptime check runs a script: approve it on its card." and "Approve 2"; the change's card had both texts, "Runs as you approved it until you answer.", "Keep as it is" and "Approve the change". "Approve 2" approved the change and an AI job, and the script job stayed; the bot carried on once for both. "Decline and remove" on the script job read "Declined and removed", and the job was gone. Needs you gives a black screenshot on Android, so that screen was read as text, not seen.
- **C1, C3, C6, C9 on the web page.** At the owner's first look, at phone width over the tailnet ([milestone8.md](milestone8.md), First look).
- **After SURE-006.** A reply of 876 characters that ended in a question carried `question` in one line; the phone showed "Mail Sorter asks" with that question. An earlier notification had the same words, so this one sight does not prove the fix: `test/asks-you.test.js` and `NeedWordsTest` hold it.

Not walked on a screen, each held by a test: a second change that replaces the first and the owner's own edit (`test/staged-changes.test.js`); a restart with a change waiting (the same file); a yes after a newer message or after 24 hours (the same file, and `test/staged-changes-scheduler.test.js`); a Board tile with a change (`test/dashboard.test.js`); a question in a run the Chief started (`test/asks-you.test.js`); the second change's card on Android after the first was answered (`ChangeCardTest`); "Always allow this action" on Android, which needs a connected app (C4; no test opens the dialog).

C17 was not walked: no Android app built from Milestone 7 was run against this server. What the server answers such an app is held by `test/staged-changes.test.js`; that the older app reads the new feed event safely was read from its code.

## The owner's checklist

The server already holds what steps 1 to 5 need: News Watcher has a change to "Morning news" waiting, a script job "Uptime check" and an AI job "Monthly recap"; Mail Sorter asks a question.

On the web page (http://localhost:4801, or the tailnet address from a phone) or in the Android app on the emulator:

1. **The list.** Mail Sorter's line reads "Asks: Which mailbox should I sort first, Work or Private?" with a round "?" in its colour. (C6)
2. **Needs you.** Under the title: "Uptime check runs a script: approve it on its card." and the button "Approve 2". (C1)
3. **The change.** The card "Morning news: a change" shows the approved time and the new one, the approved text struck above the new, and "Runs as you approved it until you answer." Tap "Keep as it is": it reads "Kept as it was: …", and the job is still in News Watcher's jobs, unchanged. (C9, C11)
4. **Approve all.** Ask News Watcher for the change again ("Change your Morning news job to 08:00 and three stories"), then tap "Approve 2": the change and "Monthly recap" are approved, "Uptime check" still waits. (C1, C10)
5. **Decline.** On "Uptime check" the button reads "Decline and remove". Tap it: "Declined and removed", no question in between, and the job is gone. (C3)
6. **Answer the question.** Open Mail Sorter and tap an answer, or type one: the "?" and "Asks" go from the list, also in a second window. (C6)
7. **A proposal carries on.** Write to Shopper: "Tell me when a litre of oat milk at Delhaize drops under 2 euro; set up a daily job for it." Its card says it carries on. Approve it: Shopper writes one more line that the job is live. (C15)
8. **On the phone.** With the app in the background, write to Mail Sorter on the web page: "Ask me which mailbox to sort first, with answer buttons." The notification reads "Mail Sorter asks" and the question. (C7)

Failure cases to try:

- Ask News Watcher for a change, then for a different change before answering: one card, with the newer change. (C12)
- With a change waiting, edit that job yourself in the bot's jobs: your version is live at once and the card goes. (C12)
- In a bot's chat on Android, tap "Keep as it is" on a change, then ask for another change: a new card appears under the "Kept as it was" line. (SURE-006)
- Ask a bot to add only a script job, and nothing else waits: no "Approve all" button. (C2)

## What cannot be tested by hand

- A question in quiet hours needs the night, or quiet hours set through the Chief to cover the present hour (C5). It was walked by the clock on 2026-10-07.
- A yes after 24 hours (C16): held by a test with a set clock.
- An Android app from Milestone 7 against this server (C17).
- "Always allow this action" on Android needs a connected app with a write waiting (C4).

## Scenarios

| Scenario | Checklist step, walk or test |
| --- | --- |
| C1 | Steps 2 and 4; `test/approvals-web.test.js`, `ApproveAllTest` |
| C2 | Failure case 4; `test/approvals-web.test.js`, `ApproveAllTest` |
| C3 | Step 5; `test/asks-you.test.js`, `NeedWordsTest` |
| C4 | Not walked; the sentence only, `ChangeCardTest` |
| C5 | Walked by the clock; `test/asks-you.test.js` |
| C6 | Steps 1 and 6; `test/asks-you.test.js`, `AsksTest`, `BotSubTest` |
| C7 | Step 8; `test/asks-you.test.js`, `NeedWordsTest` |
| C8 | `test/asks-you.test.js` |
| C9 to C11 | Steps 3 and 4; `test/staged-changes.test.js`, `test/staged-changes-scheduler.test.js` |
| C12 | Failure cases 1 and 2; `test/staged-changes.test.js` |
| C13 | `test/staged-changes.test.js` |
| C14 | `test/dashboard.test.js` |
| C15 | Step 7; `test/staged-changes.test.js` |
| C16 | `test/staged-changes.test.js`, `test/staged-changes-scheduler.test.js` |
| C17 | Not walked; `test/staged-changes.test.js`, `StagedChangeTest`, `NeedWordsTest`, `AsksTest` |
| C18 | Real use, below |

## Real use (C18)

On the owner's own botdot server and phone, with real Claude: C6 with C7, C9 with C11, and C15. Open: left for after the merge. The owner was told it was open and asked whether it comes before the merge or after, and accepted the milestone without doing it; "after the merge" is the reading of the session that ran the acceptance, not the owner's words.

## Acceptance

Accepted by the owner on 2026-10-07 ("Approved"), on runtime `7161db0` (`task/sure-005`), with the test server on this Mac, the tailnet address and the Android emulator at hand. The owner reported no failure. What the owner was told with the checklist and did not decide: the stale card, "Always approve" on an AI job, and the task gate at its budget, all under "What cannot be relied on".
