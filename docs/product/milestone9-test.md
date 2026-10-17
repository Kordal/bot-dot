# Milestone 9 test: memory the owner can trust

Test document of [Milestone 9](milestone9.md), written by the acceptance task MEM-009.

## Review

The milestone review ran on the diff from main, by the `kordal-reviewer` agent (Claude Opus 5.5), once per axis, each with a context of its own. Every finding was checked against the code before it was acted on.

| Pass | Reviewed | Result |
| --- | --- | --- |
| 1 | `main...30937c9`, MEM-001 to MEM-008 and MEM-010, once per axis | No high. Four medium, eleven low |
| 2 | `milestone9...4117271`, the fix task MEM-011 only: its task review by `kordal-task-reviewer`, both axes; no further milestone pass | No high or medium left. Eight findings: six fixed, two rejected with reasons in its plan |

Checked whole by pass 1 and found sound: the schema additions and the interrupted erase, the 30-day purge, eviction by source, the Chief's routes and the guard of the bots' memory route, the prompt file's mode, owner, removal and sweep, the refusal of an old `claude`, and that no text from memory is printed raw into a prompt. Nothing outside the scope was built: the new tables hold ids only, and a note gained only its source and its end.

Medium findings of pass 1, all fixed in MEM-011 (`8573e85`):

1. **A reader that did not ask "left out"** (Standards). In an exchange with a teammate a bot was handed its own earlier run also when a forget had left it out. Fixed, and the Chief no longer reads the question of a left-out reply either.
2. **A restore unpinned in silence** (both axes; capability 8, D13). Restoring a pinned note into a full pinned set unpinned another and said nothing. Fixed: the answer and the chip name it, for a bot, the Chief and the owner's route.
3. **A forget left a waiting addition** (Spec; journey 6). A change that waited on a card with the forgotten sentence survived the forget, and "Approve all" would have put the text back. Fixed: the forget takes it along, and names any other change that still waits and holds the words.
4. **A reminder did not count as read** (Standards; ADR 017). A reminder that went off was quoted into the owner's turn without marking it, so its text could have been saved as the owner's word. Fixed.

One finding of the review of MEM-008 became MEM-010 before the milestone review: the notification of a skill a bot wrote offered "Install" without showing the text. Its yes is now given on its card only.

### What cannot be relied on

- **What a bot chooses to save.** The tests show what botdot stores, prints and refuses, against a stand-in for Claude. Three runs on real Claude (below) and the walks went as wanted. A bot that does not save what the owner said before it uses another tool saves it as "after outside content", not as the owner's word: that rests on one sentence of its instructions.
- **The third live run used another model.** The baseline and the run after MEM-004 were made with `claude-opus-5-5`; the run at acceptance came out on `claude-sonnet-5-5`, the model Claude Code chose on this Mac that hour. Its verdicts (nothing worse) compare two models, not only two versions of botdot.
- **"What do you remember?"** is answered by a model from the complete list. There is no screen to check it against; the walk compared it with the store.
- **Meaning search.** On the real bge-m3 model 10 of 12 paraphrases bring their note; "Warszawie" does not bring a "Warszawa" note, and a bot with fewer than five notes gets almost nothing by meaning. In a small memory one shared word is enough: "What is 17 times 23?" brought the time-zone note by "time".
- **Notes from before.** They get their source from the run that saved them where its file exists; the rest count as the bot's own and can be unpinned.
- **The Docker image** was started once by MEM-005 (meaning search on by default, after a fix to the image). D1 and D2 were walked on a server started with `node`, with Claude Code 2.1.292; the pinned 2.1.284 was run by hand by MEM-002.
- **Android** was not walked on the emulator: its unit tests (367) hold the chip, the card, the notification and "Approve all", and the build, tests and lint pass.
- **An Android app from Milestone 8 against this server** (D28) was not run.
- **A full pinned set, a job's second run, a note whose end passed while botdot was off, a restart during an erase, the review and a guarded card** were not walked with real Claude: tests hold them (below).

### Follow-up

Low findings and open points, for the owner to decide; none is fixed.

Behaviour:

- The chip of an edit reads "Updated: <new text>"; the "(was: React)" of the prototype is not there.
- While a bot forgets, its working line reads "Tidying its memory"; removing and restoring have no words of their own.
- A bot asked for another bot's private note asks that bot for it with a message. Whether a bot may hand its private notes to a teammate is decided nowhere.
- Under the sentence "Claude Code on this machine is too old for botdot" the apps still offer "Sign in to Claude".
- A tap on a Board tile, and a run with no message, count as runs the owner started. A run a teammate started saves "after outside content".
- Every earlier version of a note is purged after 30 days, not only removed notes. A deleted bot's chats leave the owner's search; its run files stay.
- A waiting edit whose new text is a forgotten sentence is named by the forget and not taken away. A waiting forget asked for twice keeps only the first asker's run.
- Asking again for a change that already waits never loosens it: an end is replaced only by another end, and a guarded change stays guarded.
- No control and no tool leaves one run out by hand except a forget.
- A bot created later does not get a preference the Chief filed with each bot it fitted.
- An install that never chose gets meaning search at its next start on the Docker image: vectors for past runs are made in the background, about two hours per 10,000 runs.
- `CLAUDE.md` and auto-memory files a bot left before this milestone stay on disk, unread (ADR 014): the owner decides at acceptance whether they are removed.

Code and documents:

- The forget's sentence is written twice (`SAY.forgot`, `CHIEF_SAY.forgot` in `lib/learning.js`), and the filter of a list of ids three times.
- A run's two private files are removed in two ways (`fs.rmSync`, `identity.removePrivate`).
- `POST /api/memory/notes` answers `{ note, … }`, so an app from Milestone 8 still reports a failed add after the save. Unchanged from before.
- `.memory-list`, `.memory-note` and `.memory-add` keep their names in `public/style.css` for the screens that still draw with them.
- The task gate failed once and passed on a second run of the same commit (MEM-010); which test it was, was not caught. Milestone 8 names `test/chief-message-waits.test.js` for the same.
- The task gate's budget was raised from 3 to 5 minutes by the owner on 2026-10-07; `npm test` alone takes a little over two.

## How to start it

From branch `task/mem-009`:

- **The botdot server:** a test server on this Mac with its own data folder (`.test-data` of the main checkout), started by the agent: http://localhost:4801. It uses the Claude sign-in of this Mac. It has three bots: News Watcher, Mail Sorter and Shopper.
- **From a phone or another computer on the tailnet:** https://mac.example.ts.net:4801 (Tailscale Serve).
- **Android:** the debug build of this branch is `android/app/build/outputs/apk/debug/app-debug.apk`; on the emulator it reaches that server through `adb reverse tcp:4801 tcp:4801`.

## What was walked before handing over

On 2026-10-07, on that server, with real Claude, through the server's own API as the web page uses it:

| Step | Result |
| --- | --- |
| "I always use pnpm." to Shopper | Chip "Remembered for all bots: The owner always uses pnpm as their package manager." While the run went, the process list held `--append-system-prompt-file` with a path and no text of the prompt (D1) |
| "This week I am in Berlin." | Chip "Remembered for all bots until Sun 11 Oct: …" (D10) |
| "My dentist is Dr Zebrowska, remember that.", then "Forget what I told you about my dentist." | Chip "Forgot 1 note"; the reply says the chat is left out and stays in the owner's history (D5) |
| "Who is my dentist?" to the same bot, to News Watcher told to search its memory and past runs, and to the Chief | None knows. The Chief found only the two runs that asked the same question (D5) |
| "What package manager do I prefer?" to News Watcher | "pnpm", from the shared note |
| To the Chief: "We decided to use PostgreSQL for the price tracker. Note it for Shopper." | Chip "Remembered for Shopper: We use PostgreSQL for the price tracker (decided 2026-10-07)." (D24) |
| To the Chief: "Ask me before you create more than one bot." | Chip "Noted for myself: …" (D24) |
| To the Chief: "What does Shopper remember?" | Its one note and the two shared ones, as the store holds them |

At the first look (MEM-007, 2026-10-07) the owner walked the web page over the tailnet: no memory in a bot's settings, Settings or Setup, the chip, "What do you remember about me?" and a forget. Answer: "ok all good".

The live eval on real Claude, three repeats each time:

| Run | Reading | Writing |
| --- | --- | --- |
| Baseline, MEM-001, `claude-opus-5-5` | 60 of 60 | 27 of 30 by today's measure (Berlin had no end date) |
| After the wording, MEM-004, `claude-opus-5-5` | 60 of 60 | better 1, the same 9, worse 0 |
| After the lookup, MEM-005, `claude-opus-5-5` | 60 of 60 | better 1, the same 9, worse 0 |
| At acceptance, `59f1c02`, `claude-sonnet-5-5` | 60 of 60; irrelevant records 119 → 30 | better 1 (Berlin, 3 of 3 with its end), the same 9, worse 0 |

The comparisons are `test/live/after-mem-004.md`, `after-mem-005.md` and `after-milestone9.md`.

## The owner's checklist

On the web page, then the same on the phone where it says so. About 15 minutes.

1. **No memory screen.** Open a bot's settings, the Chief's settings, Settings and Setup. Expect: nothing about memory. On Android: a bot's and the Chief's settings have no Memory section.
2. **Remember.** Tell a bot "I always buy oat milk." Expect: a chip "Remembered: …" (or "for all bots"), which does nothing when tapped.
3. **Said twice.** Say it again in other words. Expect: no second chip; the bot says it has it.
4. **A maybe.** "We might switch to soy." Expect: no chip.
5. **A passing state.** "Next week I'm in Lisbon." Expect: a chip "… until <the Sunday>: …". Then "I'm in Paris." with no end. Expect: the bot asks until when.
6. **Correct.** "No, almond milk, not oat." Expect: a chip "Updated: …" and one note, not two.
7. **Ask.** "What do you remember about me?" Expect: the notes with who said each and when.
8. **Forget.** "Forget what I told you about milk." Expect: "Forgot 1 note"; ask the bot, another bot and the Chief about milk: none knows. Your own search still finds the chats.
9. **Bring back.** Tell a bot to remove a note ("that's no longer true"), then "bring back what you removed about …". Expect: "Restored: …".
10. **The Chief files it.** "We decided to use PostgreSQL for X, note it for <a bot>." Expect: "Remembered for <bot>: …". "Ask me before you create more than one bot." Expect: "Noted for myself: …".
11. **The Chief lists.** "What does <bot> remember?" Expect: that bot's notes.
12. **In other words.** Ask a bot about something it holds as a note, with different words, in a new message. Expect: the right answer.

## Failure cases to try

- **A forget after the web.** Ask a bot to look something up on the web and, in the same message, to forget a note. Expect: a card "Forget for good" with "Keep" in Needs you; "Approve all" does not take it; on the phone its notification has no yes.
- **A skill after the web.** Ask a bot to read a page and write itself a skill from it. Expect: a card with the skill's whole text; its notification offers no "Install".
- **A reminder.** Let a reminder go off in a Chief chat and answer "remember that …". Expect: the chip says "after outside content".
- **Restart.** Stop and start the test server; ask a bot what it remembers. Expect: the same notes.

## What cannot be tested by hand

- A note's end: it leaves every prompt the day after. Tests hand the clock in (`test/memory-forget.test.js`).
- The purge 30 days after a removal: the same.
- A pinned set of thirty: `test/memory-source.test.js`, `test/memory-source-api.test.js`.
- An erase interrupted by a restart, and the one rebuild of the index: `test/memory-forget.test.js`.
- A Claude Code too old for the prompt file: `test/prompt-private.test.js`.

## Scenarios

| Scenario | Held by |
| --- | --- |
| D1 | Walked (the process list); `test/prompt-private.test.js` |
| D2 | `test/prompt-private.test.js`; by hand on Claude Code 2.1.284 (MEM-002, ADR 014) |
| D3, D4 | `test/prompt-private.test.js` |
| D5 | Walked; `test/memory-forget.test.js`, `test/memory-forget-api.test.js`, `test/memory-review-fixes.test.js`; checklist 8 |
| D6 | `test/memory-forget-api.test.js`; failure case 1 |
| D7 | `test/memory-forget.test.js`, `test/memory-forget-api.test.js` |
| D8 | The same; checklist 9 |
| D9 | The same |
| D10 | Walked; the same; checklist 5 |
| D11 | The same; checklist 5 |
| D12 | `test/memory-source-api.test.js` |
| D13, D14 | `test/memory-source.test.js`, `test/memory-source-api.test.js`, `test/memory-review-fixes.test.js` |
| D15, D16 | `test/memory-source-api.test.js`; failure case 2 |
| D17 | `test/memory-source.test.js`; checklist 3 and 6 |
| D18 | `test/memory-source.test.js`, `test/memory-source-api.test.js`; checklist 7 |
| D19 | `test/memory-lookup.test.js`; Warszawa on the stub embedder only; checklist 12 |
| D20 | `test/memory-recall.test.js` |
| D21 | `test/memory-recall-api.test.js` |
| D22 | The first look; `test/no-memory-screen-web.test.js`; Android's `NoMemoryScreenTest`; checklist 1 |
| D23 | `test/no-memory-screen-web.test.js`; Android's `MemoryWordsTest`; failure case 1 |
| D24 | Walked; `test/chief-memory.test.js`; checklist 10 and 11 |
| D25 | `test/chief-memory.test.js`, `test/tools.test.js` |
| D26 | `test/memory.test.js`, `test/memory-forget-api.test.js` |
| D27 | `test/prompt-private.test.js` (about 91,000 characters of 100,000), `test/memory-recall.test.js` (0.3 ms and 21 ms at 10,000 runs) |
| D28 | `test/memory-source-api.test.js`, Android's `ApproveAllTest`; not walked with an app from Milestone 8 |
| D29 | The four live runs above |
| D30 | Real use, below |

Both gates passed on `59f1c02`: `pr-check` (tools-real) and `premerge-check` (the Android build, tests and lint).

## Real use (D30)

Not done before the acceptance. The owner accepted the milestone on the test server without saying when real use follows: it stays open, for after the merge, on the owner's own botdot server and phone.

## Acceptance

On 2026-10-07 the owner answered the checklist with "accepted", on the test server from `task/mem-009` at `7520a36`, the commit both gates cover.

Left open by that answer, and recorded here as open: what happens to the `CLAUDE.md` and auto-memory files bots left before this milestone (they stay on disk, unread, as ADR 014 leaves them), and real use (D30).
