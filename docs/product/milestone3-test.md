# Milestone 3 test: the Chief of Staff writes first

Test document of [Milestone 3](milestone3.md), written by the acceptance task CHF-005.

## Review

The milestone review ran on the whole diff from main, by the `kordal-reviewer` agent (Opus 5.5, high effort), once per axis each time.

| Pass | Reviewed | Result |
| --- | --- | --- |
| 1 | `main...f0bcf1e`, CHF-001 to CHF-004 | One high, four medium, seven low. The walk of the Flows found one more medium |
| 2 | `458a831..6543625`, the fix task CHF-006 only | No high. One medium, eight low |
| 3 | `6543625..864d001`, the fix task CHF-007 only | No high or medium. Ten low |

High and medium findings, all fixed:

1. **High. A look could send the owner's data to any website.** Its prompt holds the shared memory and recent chats, and it had web fetch. Fixed in CHF-006: a look has web search only. ADR 006 now states what remains: a search query can carry some of the owner's data to the search provider.
2. **A "nothing" with a sentence after it was posted** as a message (A2). Fixed in CHF-006.
3. **What the Chief wrote before was forgotten** when its chat was deleted, and only the last 20 were seen (A6, A9). Fixed in CHF-006: every unasked message is kept with its rating in `looks.json`.
4. **Web page: an unasked message that arrived during the owner's turn stayed hidden** until the chat was reopened. Fixed in CHF-006.
5. **Android could not open a Chief chat holding a bot's failed report** (the Mac had the same fault, fixed in CHF-004). Fixed in CHF-006.
6. **"Stop writing first" did nothing in an older chat** (found by walking A8 with the real Chief). Cause: Claude Code 2.1.287 ignores new instructions when it resumes a session, so every Chief chat ran on the instructions, shared memory and date of its first turn, older than this milestone. CHF-006 added a note after an unasked message; pass 2 found that covers only some chats. Fixed in CHF-007: a resumed chat gets the time, shared memory and mentions every turn, and the current instructions once whenever they change.

### Follow-up

Low findings, for the owner to decide; none is fixed.

- The daily limit (3) is written in five places (`settings.js`, `look.js` twice, `mcp-server.js`, the note after an unasked message).
- `runLook` copies the Chief's tools-server setup and Claude arguments from `send()`; they must be kept in step by hand.
- The Mac decides "which message gets thumbs" without the index check the web page and Android have, and keeps that code in `ChiefChatModel.swift` instead of a file of its own.
- No look runs in the first hour after every start of the botdot server, not only the first start after the update: frequent restarts lose looks.
- `looks.json` keeps every unasked message for ever (only 60 days are read), with up to 1000 characters of the owner's answer, also after the chat is deleted. "Already raised" in a look's prompt has no size cap.
- A real message whose first word is "Nothing" is dropped; the look's prompt does not warn the Chief.
- The note after an unasked message says "botdot wrote that in a look" after all new items; with a bot's reply after it, "that" points at the wrong one.
- ADR 006 was edited in place twice instead of superseded, and its "Changed by" names CHF-006 but not CHF-007.
- `instructionsKey` appears in `GET /api/chief` and is not in `docs/api.md` (like `sessionId`).
- The block of current instructions says "your instructions have changed" also when they did not (after a failed turn).
- Text in the shared memory could close the `<from-botdot>` block early; nothing escapes it.
- If Claude Code compacts a session at the start of a turn, that turn may run without the instructions; the next turn has them.
- An unasked message waiting for the Chief's reply is lost if botdot restarts in that moment, though its record says it was raised. Older than this milestone for reminders.
- Claude Code's own auto memory is on for the Chief and makes it try to write files (denied).
- `premerge-check` failed once on `45fadbc` without a clear cause and passed on the rerun.
- The browser test `test/browser/ratings.cjs` was written but runs in no gate: the repository does not carry Playwright.

## How to start it

It is running on this Mac, from branch `task/chf-005` at the commit of this document:

- **Web:** http://localhost:4801. A test botdot server with scratch data: six bots, three Chief chats, one earlier unasked message (rated 👎 in the first look). It uses this Mac's Claude sign-in, so the Chief and its looks answer for real. Looks can be started by hand (`BOT_DOT_LOOK_ON_DEMAND=1`). Its quiet hours are set to 03:00–04:00, so that looks can be tried at night; the Chief changes them back when you ask.
- **Android:** the emulator (Medium_Phone), with the debug app built from this branch, connected to that server.
- **Mac:** the Debug build with its own bundle identifier (`dev.botdot.mac.m3test`), connected to that server. The installed botdot app is untouched.

To start a look by hand:

```bash
curl -X POST -H 'X-Bot-Dot: 1' localhost:4801/api/chief/look
```

It answers `{"looked":true,"posted":true}` when the Chief wrote, `{"looked":true,"posted":false}` for nothing, or why no look ran.

To start it again, in the task's worktree: `PORT=4801 HOST=0.0.0.0 BOT_DOT_ALLOWED_HOSTS=10.0.2.2 BOT_DOT_LOOK_ON_DEMAND=1 BOT_DOT_DATA=<scratch folder> node server.js`; `adb reverse tcp:4801 tcp:4801`; `open -n <repository>/macos/build/m3test/Build/Products/Debug/botdot.app --args -botdot.server http://localhost:4801`.

## What was walked before handing over

On 2026-10-03, with the real Chief on the test server:

- **A4:** a look in quiet hours answered `quiet-hours`.
- **A2:** four real looks answered "nothing"; the chats were unchanged and nothing was counted. The test data is thin (three short chats) and the one earlier message is rated 👎, so the Chief was cautious. **No real look posted a message here yet**: A1 rests on the unit tests until step 2 below or A14.
- **A5:** the rating route set, moved, cleared and refused ratings as specified.
- **A8:** in the old chat (`whats app`, from 29 September), "stop writing first" switched looks off (the next look answered `off`), the Chief gave today's date, and "write again, up to three a day" switched them back. Before CHF-007 the same chat ignored it.
- The first looks of the three apps (CHF-002, CHF-003, CHF-004): the owner said yes.

## Checklist

Do each step where it says; look at the other apps where it says so.

1. **The thumbs (A5, A11).** Open the Chief chat `whats app` on the web page, Android and the Mac. Its last unasked message ("About the disk check…") shows 👍 and 👎 in every app. Tap 👍 on Android: it fills on the web page and the Mac within a moment. Tap it again: it clears everywhere. Tap 👎 on the Mac.
2. **A message arrives (A1, A6).** Ask the Chief something it can follow up on later (a question you would like an update on). Then start a look by hand (above), a few times if it says nothing. When it posts: the Chief's row shows a dot in every app, the chat a "New" line above it, and the phone and the Mac a notification. The message names what you asked.
3. **Answering (A7).** Answer that message in the chat. The Chief carries on knowing what it wrote.
4. **During your turn (finding 4).** On the web page, send the Chief a message and, while it answers, start a look. If it posts, the unasked message shows with its thumbs when the answer is in.
5. **Steering (A8).** Tell the Chief "write at most once a day". It confirms in one line. Start looks: after one message that day, a look answers `limit`. Then "you can write up to three a day again".
6. **Stop (A8).** Tell the Chief "stop writing first", in any chat. A look answers `off`. Then turn it back on.
7. **No repeat (A9).** After a message, start more looks: none raises the same topic again.
8. **Failed report on Android (A13, finding 5).** Open a Chief chat that holds a bot's failed report on Android and on the Mac (there is none in the test data; skip if you have none).
9. **Restart (A12).** Ask me to restart the test server: ratings, the setting and the day's count stay.
10. **Real use (A14).** After the merge, on the owner's own botdot server: see "Real use (A14)" below.

Failure cases to try: a look in quiet hours (set them to now with the Chief) answers `quiet-hours`; a look while the Chief answers you answers `busy`; turning the Wi-Fi off on the phone and tapping a thumb puts it back with "Couldn't save your rating".

What cannot be tested by hand here: a look that fails because Claude is signed out (covered by the unit tests); backup and restore (covered by `test/backup.test.js`); a fresh find from the web (looks now have web search only and found nothing to verify in the stage 4 trial; A14 shows whether they do).

## Real use (A14)

Decided by the owner on 2026-10-03: the test server is enough for acceptance; A14, two days of real use on the owner's own botdot server, follows after the merge. Tuning the look's prompt from it is follow-up work.

## Acceptance

The owner walked the checklist on the web page, Android and the Mac and accepted the milestone on 2026-10-03 ("All ok"), on commit `f27944a` of `task/chf-005`. Real use (A14) follows after the merge.
