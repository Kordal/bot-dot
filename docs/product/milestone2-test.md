# Milestone 2 test: a team that feels like a messenger

Test document of [Milestone 2](milestone2.md), written by the acceptance task MSG-011.

## Review

The milestone review ran on the whole diff from main, by the `kordal-reviewer` agent (Opus 5.5, high effort), once per axis each time.

| Pass | Reviewed | Result |
| --- | --- | --- |
| 1 | `main...7c96a90`, all ten tasks | No high finding. Four medium, seven low |
| 2 | `7c96a90..9c156bd`, the fix task MSG-012 only | No high or medium finding. Four low; one medium defect confirmed that is older than this milestone |

Medium findings of pass 1:

1. **Mac: the "Needs you" dot on the Dock icon was removed** by MSG-010, which read "No Dock badge" as "remove the existing one". Fixed in MSG-012: restored exactly as on main.
2. **Web and Mac: no "New" line when the first new reply is older than the runs a chat loads** (A3). Fixed in MSG-012: the chat reads back to it, as Android did already.
3. **Mac: no notification after the feed's `reset`** (a server restart, or many missed events), while Android rebuilt one. Fixed in MSG-012.
4. **A bot's follow-up reply after teammates answered a scheduled run never counts as new,** though it shows unfolded in the chat. Not changed: it is the owner's decision, asked in the checklist (step 12).

### Follow-up

Low findings, for the owner to decide; none is fixed.

- A failed memory review shows "Couldn't finish" in the chat and makes no dot (asked with step 12).
- The read report waits without a time limit for "what is new" on the web page and the Mac; Android stops waiting after 3 seconds.
- Deleting a Chief chat or a bot that has new replies sends no feed event, so other apps keep its dots or notification until they next reconnect.
- The Chief's row in the list does not show the Chief's opening line; pinned bots on Android have no preview either.
- While a bot works, the step text and the opening line both show under its chat.
- The Chief's "previous chats" menu shows no dots per chat.
- Mac: a notification added and removed in the same instant may stay until the next reconnect (not verified).
- Mac: when one read fails during the catch-up after `reset`, that chat gets no notification until the next `reset`.
- Mac: every reconnect now makes three requests even when no notification is shown.
- Web: when the server cannot be asked for older runs, each redraw tries again.
- The chat key ("bot:…", "chief:…") is taken apart in several places on the server, the web page and Android.
- README, `android/README.md` and `macos/README.md` do not mention the opening line.
- The Chief cannot tell a change that waits for the owner's OK from one that was lost (`create_bot` and `update_bot` do not say it waits).
- A bot the Chief creates gets memory-only learning, while the Chief's instructions describe full learning as the default.
- `chat_seen`, `webActive` and `POST /api/presence` can be removed once no supported app needs them.
- The plan of MSG-004 says 14 new tests; there are 13.

Older than this milestone, found by the review, not fixed here:

- **Medium. On the Mac, a Chief chat that holds a bot's failed report does not load.** The server stores such a report with `error: true`; the Mac app expects text (`ChiefMessage.error` in `Models.swift`). Both sides are on main already. Whether Android has the same fault is not checked.

## How to start it

It is running on this Mac, from branch `task/msg-011` at `6ebfe58` plus this document:

- **Web:** http://localhost:4801. A test botdot server with scratch data: six bots (Plant Care pinned; Mail Assistant, Fleet Doctor, Cook and Web Surfer in Work; WhatsApp in Other), no jobs. It uses this Mac's Claude sign-in, so bots answer for real.
- **Android:** the emulator (Medium_Phone), with the debug app built from this branch, connected to that server.
- **Mac:** a Debug build with its own bundle identifier (`dev.botdot.mac.m2test`), open and connected to that server. The installed botdot app and its settings are untouched. macOS asks once whether this build may send notifications: allow it, or steps 9 and 10 show nothing.

To start it again, in the repository: `PORT=4801 HOST=0.0.0.0 BOT_DOT_ALLOWED_HOSTS=10.0.2.2 BOT_DOT_DATA=<scratch folder> node server.js`; `adb reverse tcp:4801 tcp:4801`; `open -n macos/build/m2test/Build/Products/Debug/botdot.app --args -botdot.server http://localhost:4801`.

## Checklist

Do each step where it says; look at the other apps where it says so.

1. **After the update (A12).** Open the three apps. No bot has a dot, although every chat has old replies.
2. **A dot (A1).** On the web page open Cook's chat and ask "What can I cook with eggs and rice?". Before it answers, click Mail Assistant. When Cook has answered, Cook shows one dot in its colour after its time, on the web page, the phone and the Mac. The list is in the same order as before (A6).
3. **More dots (A1).** Ask Cook two more things the same way, leaving its chat each time: two dots, then three. A fourth reply still shows three, and never a number.
4. **The "New" line (A3).** On the phone open Cook: the chat opens at a thin "New" line above the first reply you have not read. Cook's dots go on the web page and the Mac within a moment (A4).
5. **The line goes.** Leave Cook and open it again: no line.
6. **Read while watching (A5).** Stay in a bot's chat and ask it something: its answer makes no dot and no line, in any app.
7. **In the background.** On the Mac open Web Surfer's chat, then put another app in front. Ask Web Surfer something from the web page and leave its chat there. The Mac shows a dot; back in the Mac app, the line is above the new reply and the dot goes.
8. **The Chief.** Ask the Chief something from the web page and click a bot before it answers: the Chief's row gets a coral dot; clicking it opens the chat at the line.
9. **Android notification (A11).** With the phone app in the background and no app showing Fleet Doctor's chat, ask Fleet Doctor something from the web page and leave its chat. The phone shows a notification with Fleet Doctor's head and hat, and the app icon gets its dot. Open Fleet Doctor's chat on the Mac: the notification and the icon's dot go.
10. **Mac notification and Dock.** With the Mac app in the background, let a bot answer as in step 9: a notification appears in Notification Centre; reading the chat on the web page removes it. The Dock icon shows no badge for it. (The Dock dot is for "Needs you" only, as before.)
11. **The opening line (A7, A8).** Ask Fleet Doctor "What do your notes say about my disk?". While it works, a line such as "Checking my notes about the disk…" shows under the chat with a pulsing dot, and as Fleet Doctor's preview in the list, on all three apps. When the answer arrives the line is gone and the chat holds only the answer. Ask a bot something it answers without tools ("Say hello"): no line.
12. **Two questions for you.** (a) When a bot answers after its teammates replied to a scheduled run, the reply shows in the chat but makes no dot. Should it? (b) A failed memory review shows "Couldn't finish" and makes no dot. Should it?
13. **A new bot (A9).** Ask the Chief for a bot in your own words. Its reply starts with one line saying what the bot does and never does. Open the bot's settings: its task names one job, what it never does, its voice and when it wakes. Judge: is this the bot you asked for?
14. **Existing bots (A10).** Open the settings of Cook or Mail Assistant: the task is as it was.
15. **How it feels.** Your judgement, in your words: can you see at a glance which bots have something new, and does a working bot tell you what it is doing?
16. **Android, pinned heads.** The row of pinned heads is 6 dp taller than before, so a new reply's dots move nothing. Is that acceptable?

## Failure cases to try

- **Restart (A12).** Leave one reply unread, stop and start the test server: the dot is still there.
- **Offline app (A13).** Turn on aeroplane mode on the emulator, let a bot answer, turn it off: the phone shows the server's dots.
- **Screen off.** Open a chat on the phone, turn the screen off, let that bot answer, turn it on: the reply is new, with the line above it.
- **A failed run.** Stop a run while it works: "Couldn't finish" or "Stopped" shows, the opening line is gone, and with the chat not on screen it makes a dot.
- **Two jobs.** Ask the Chief for one bot that does two unrelated things: it makes one bot per job or asks one question.

## What cannot be tested by hand here

- **A quiet scheduled run and a bot-to-bot exchange (A2):** the test data has no jobs and no linked bots. Server tests cover both on thirty runs; the Android and Mac tests cover that neither notifies.
- **Backup and restore (A12):** covered by a server test only.
- **Mixed versions:** no older server is at hand. Tests cover apps against a server without the features.
- **A reply older than what a chat loads (A3):** needs more than forty runs after one unread reply; seen by the builder on the web page and the Mac with seeded runs.
- **A physical phone:** Android is seen on the emulator only.
- **Browser tests** are in no gate, because the repository does not carry Playwright.

## Owner's result

**Passed.** On 2026-10-02 the owner tested the milestone on the web page, the Android emulator and the Mac test build, all running from commit `6ebfe58` of `task/msg-011` against one test server with a scratch copy of six bots, and answered: "it passes". The two questions of step 12 were not answered; both behaviours stay as they are and remain under Follow-up.
