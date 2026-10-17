# Milestone 10 test: a team in one chat

Test document of [Milestone 10](milestone10.md), written by the acceptance task GRP-008.

## Review

The milestone review ran on the diff from `main`, by the `kordal-reviewer` agent (Claude Opus 5.5), once per axis, each with a context of its own. Every finding was checked against the code before it was acted on.

| Pass | Reviewed | Result |
| --- | --- | --- |
| 1 | `origin/main...c5dd7cc`, GRP-001 to GRP-007 and GRP-009, once per axis | No high. Five medium, fifteen low |
| - | GRP-011, the owner's change at the test (`8f43e63`): self-reviewed, a control moved | No findings |
| 2 | The fix task GRP-010 only (`a3b676e`): three task reviews by the same agent, the second and third of the fixes themselves, the second with mutations; no further milestone pass | No high or medium left |

Read whole by pass 1 and found sound: the store of groups and the line of turns (a turn written before its run, one turn of a message at work, "Stop all", "Go on", a restart); the Chief's routes (list, make and change only, only in a turn the owner started, no chat, no delete, no upload); every reader that keeps a group's runs out of a bot's own chat; a handed-on turn counted as a teammate's; files copied only as a turn starts. Nothing excluded by the scope was built. Of the scenarios G1 to G24, 21 were met and G7, G12 and G19 partly.

Medium findings of pass 1, all fixed in GRP-010:

1. **A member's reply could pose as a line of the owner's** in the chat a turn reads, with fullwidth brackets, a zero-width sign, a look-alike letter or the bare words "The owner wrote:" (ADR 020). The fix of GRP-003's own review was a list of spellings. Now every entry of the chat carries a mark made for that one prompt, which no text can hold, and the chat ends on a marked line.
2. **A failed turn's error text and a bot's name** were not treated as a reply is. Fixed with 1.
3. **A group's name and a bot's description** were printed raw into a turn's prompt (rule 6). Fixed: they stand on marked lines.
4. **A question in a group rang the phone though the owner had read it on the web page** (G12, decision 8). Fixed on the server.
5. **A yes on a card started nothing while the owner's later message still waited** for that member, and carried on once it had started. Fixed: one clock.

G7's missing half (a forget in a handed-on turn waits on a card) and G19's card of a group for an app from Milestone 9 got their tests in GRP-010.

### What cannot be relied on

- **What bots do in a group.** The tests run on a stand-in for Claude. Two walks on real Claude (below) went as wanted for a question, a mention and the limit. Whether a bot passes, hands on to the right member and ends the work rests on five sentences of its instructions.
- **The second live walk shows no work handed on.** Its bots had a new bot's own tools and wanted to run commands: the first refused command stopped "the settings page needs a dark mode switch" after one or two replies, with a card in Needs you. The first walk, where bots had file tools only and stated their part as done, showed the hand-on three times.
- **The mark that protects the chat a turn reads** was reviewed three times and never tried on a real model that is being lied to.
- **Nobody of this milestone's sessions saw the Android app on a device.** Its unit tests (410), lint and build pass. No emulator was started.
- **The web page was seen in a browser by the builder of GRP-005 only,** at 1280 and 412 pixels, on the stand-in. The acceptance session's own screenshots of the live page failed; it walked the server's API. Not seen by anyone: a drag with the mouse, dark mode, a member's opening line.
- **An Android app from Milestone 9 against this server (G19)** was not run. A test reads what such an app is sent. It shows a card asked in a group as its bot's own, and can answer it.
- **"Go on" and a card of a group** were not walked on real Claude.
- **The Chief making a group** was not walked on real Claude; its tools are tested on the stand-in.

### Follow-up

Low findings and open points, for the owner to decide; none is fixed.

Behaviour:

- **The limit counts per message of the owner's,** as ADR 019 has it: two messages at work side by side can bring 24 replies without the owner, and a new message leaves a stopped line stopped until "Go on" or "Stop all". Counting per group is the other reading of decision 6.
- A category's groups stand after its bots, and a group cannot be dragged between two bots (ADR 018: one shared order would break the Milestone 9 Android app's drag).
- "All clear?" brought three near-identical replies in the second walk (one or three in the first).
- A member's run still at work when its group is deleted goes on, and its reply is in no chat.
- After a reload the group's row has no opening line until its chat is read.
- A group whose members are all paused takes a message nobody answers. A member paused while the line is stopped keeps it stopped until "Go on".
- A group's name the Chief sets reaches every member's turn without a card; the Chief cannot move or pin a group.
- A file uploaded to a group and never sent stays until the group is deleted.
- Android's search does not look in groups; a folded category's dot looks only at its bots.

Code and documents:

- The link to a group is `groupId` on runs and cards, `?group=` on `/api/runs` and `group` on search hits; who handed on is `handed`, `by` and `handedBy`.
- A bot's own chat block still protects itself with a list of spellings; "answer it the way <name> would" prints the name raw there. Both are older than this milestone.
- `refuse`, `clip` and `botsNamed` are written twice.
- The task gate failed twice on GRP-001 and twice on GRP-002, each on tests that pinned text the task changed.

## How to start it

From branch `task/grp-008`:

- **The botdot server:** a test server on this Mac with its own data folder, started by the agent: http://localhost:4517. It uses the Claude sign-in of this Mac. It has four bots (Coder, Reviewer, Issue Writer in the category Programming; Weather in House) and one group, Dev.
- **Android:** the debug build of this branch is `android/app/build/outputs/apk/debug/app-debug.apk`; on the emulator it reaches that server through `adb reverse tcp:4517 tcp:4517`.

## What was walked before handing over

On 2026-10-08, on test servers started from this branch, with real Claude (`claude-opus-5-5`), through the server's own API as the web page uses it. Three bots, a new group for each exchange, three runs each.

| Exchange | First walk (GRP-004, file tools only) | Second walk (acceptance, a new bot's tools) |
| --- | --- | --- |
| "We will work on dark mode together. All clear?" | 1, 1 and 3 replies; nobody twice, no work started | 3 replies each time, one per bot; nobody twice, no work started |
| "@Coder which branch are you on?" | Coder only, 3 to 6 s | Coder only, 4 to 10 s |
| "The settings page needs a dark mode switch." | Issue, change, review, fix: 5 or 6 replies, ended by itself | 1 or 2 replies: Issue Writer could not run commands, a card waits, the work stops with the owner |
| Two bots told never to stop | Stopped at the twelfth reply, 3 of 3 | Stopped at the twelfth reply, 3 of 3, in 40 s; each later turn "handed on by" the other |

On the owner's test server a group Dev was made and "All clear?" sent: Coder and Issue Writer answered, Reviewer passed, and the group shows two new replies.

## The owner's checklist

On the web page, then the same on the phone where it says so. About 15 minutes.

1. **The list.** Open http://localhost:4517. Expect: "Dev" as one row in "Programming", after its bots, with three heads and two dots; the folders are called categories.
2. **Read it.** Open Dev. Expect: a "New" line, each reply under its bot's name in its colour with its head; the dots go.
3. **Make one.** Open Weather's chat and tap the small plus right of its name. Pick Coder, name it "Mix". Expect: a new group in "House"; Weather's own chat as it was.
4. **Everyone reads.** In Dev: "What is each of you for, in one line?" Expect: replies one after another, nobody twice; while they work, one line per working bot and "Stop all".
5. **A mention.** "@Coder which branch are you on?" Expect: Coder only.
6. **Work together.** "Write a haiku about dark mode: Issue Writer drafts it, Coder shortens it, Reviewer judges it." Expect: each hands on by naming the next; it ends by itself.
7. **The limit.** "@Coder and @Reviewer: keep changing one word of 'The cat sat on the mat' in turn. Do not stop by yourselves." Expect: after 12 replies "The group stopped after 12 replies without you." with "Go on"; tap it: it goes on.
8. **Stop all.** While they go on, tap "Stop all". Expect: each stopped bot says so under its name.
9. **Busy.** Send "@Coder count slowly to 30" and at once "@Coder and then say done". Expect: the second waits, says for whom, with "Take back".
10. **The panel.** Tap the group's title. Rename it, take a member out, add one. Expect: the list follows. Taking a member out of a group of two is refused.
11. **The Chief.** In the Chief's chat: "Put Coder and Reviewer in a group called Pair." Expect: the group in the list and a chip naming it. "Delete Pair": it says where you delete it.
12. **The phone.** Install the debug build, open Dev, repeat 4, 5 and 10. Expect: the same; no notification for a reply.

## Failure cases to try

- **A card.** Ask Dev for something that needs a command ("@Coder run `git status`"). Expect: a card at the end of Dev with Coder's name, and in Needs you; after your yes Coder's reply is in Dev.
- **A question.** "@Coder ask me which branch to use, with two choices." Expect: Dev's row says "Coder asks: …"; on the phone a notification that opens Dev, unless Dev is open on the web page.
- **Delete.** Delete "Mix". Expect: the group goes, Weather and Coder stay.
- **Restart.** Stop and start the test server while a bot works in Dev. Expect: the cut reply says so, nobody answers twice.

## What cannot be tested by hand

- A reply that poses as a line of yours in the chat a bot reads: `test/group-reads.test.js`, `test/group-review-fixes.test.js`.
- What an app from Milestone 9 is sent: `test/groups-old-app.test.js`.
- A turn's prompt with a chat of 500 replies (81,651 characters of 100,000) and six members that pass (0.8 s of 10): `test/group-reads.test.js`, `test/group-chat.test.js`.
- A forget in a turn a member handed on: `test/group-review-fixes.test.js`.

## Scenarios

| Scenario | Held by |
| --- | --- |
| G1 | `test/groups.test.js`, `test/groups-web.test.js`, Android's `GroupsTest`; checklist 3 |
| G2, G3 | `test/group-chat.test.js`; both walks; checklist 4 and 5 |
| G4 | `test/groups-web.test.js`, Android's `GroupWordsTest`; checklist 2 |
| G5, G6 | `test/group-reads.test.js` |
| G7 | `test/group-reads.test.js`, `test/group-review-fixes.test.js` |
| G8, G9, G10, G11 | `test/group-chat.test.js`; checklist 8 and 9 |
| G12 | `test/group-review-fixes.test.js`, Android's `GroupNotifierTest`; not seen on a device |
| G13, G14, G15 | `test/group-reads.test.js`; the failure cases |
| G16 | `test/group-chat.test.js` |
| G17 | `test/groups.test.js`; checklist 10 |
| G18 | `test/group-reads.test.js` |
| G19 | `test/groups-old-app.test.js`; not run with an app from Milestone 9 |
| G20 | `test/groups-web.test.js`, `CONTEXT.md`, `docs/api.md`; checklist 1 |
| G21, G22 | `test/group-hands-on.test.js`; both walks for the limit; checklist 6 and 7 |
| G23 | `test/chief-groups.test.js`, `test/tools.test.js`; checklist 11 |
| G24 | `test/group-reads.test.js`, `test/group-chat.test.js` |
| G25 | The two walks above |
| G26 | Real use, below |

Both gates passed on `7c833d9`, before GRP-011; the head the owner tests has them again (below): `pr-check` (tools-real, 0:08) and `premerge-check` (the Android build, tests and lint, and image cleanup, 4:14).

## Real use (G26)

Not done. It needs the owner's own botdot server and phone.

## Acceptance

On 2026-10-08 the owner answered the checklist with "Approved", on the test server from `task/grp-008` at `29900fc`, whose runtime both gates cover (`pr-check` 0:07 and `premerge-check` 4:10 on `29900fc`).

During the test the owner asked for one change, delivered as GRP-011 before the answer: the small plus that makes a group stands right of the bot's name at the top of its chat, not in the bot's settings.

Left open by that answer, and recorded here as open: whether the limit of 12 counts per message of the owner's, as built, or per group; real use on the owner's own botdot server and phone (G26); and that nobody saw the Android app on a device.
