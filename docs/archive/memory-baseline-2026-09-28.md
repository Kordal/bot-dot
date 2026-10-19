# Memory baseline — 2026-09-28

Live runs of real bots and the Chief on isolated botdot servers with made-up data. Model: claude-opus-5-5. Runs per scenario: 3. Commit: 73903a2. Meaning search: off.

Correct: the final ANSWER line matches. Recall: the conversation called recall. Searches: recall calls (median). Found: recall returned a record holding the answer. At: where the first such record was among all records recall returned (median; 1 = first). Outdated, off-limits, irrelevant: records recall returned (totals) that hold a value no longer true; a value this bot must not see (another bot's note, a run left out); none of the values asked about. Time and context: medians; context is the largest prompt sent to the model in the conversation.

| Scenario · question | Correct | Recall | Searches | Found | At | Outdated | Off-limits | Irrelevant | Time | Context |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recall-taught-fact · bike-lock | 3/3 | 3/3 | 1 | 3/3 | 1 | 0 | 0 | 0 | 6 s | 30k |
| shared-vs-private · shared | 3/3 | 3/3 | 1 | 3/3 | 1 | 0 | 0 | 0 | 5 s | 31k |
| shared-vs-private · private-of-another-bot | 3/3 | 3/3 | 2 | – | – | 0 | 0 | 6 | 9 s | 32k |
| long-answer · part-number-at-the-end | 3/3 | 3/3 | 1 | 3/3 | 1 | 0 | 0 | 0 | 9 s | 40k |
| excluded-run · kept-run | 3/3 | 3/3 | 1 | 3/3 | 1 | 0 | 0 | 0 | 5 s | 30k |
| excluded-run · left-out-run | 3/3 | 3/3 | 3 | – | – | 0 | 0 | 8 | 7 s | 30k |
| unknown-fact · dentist | 3/3 | 3/3 | 3 | – | – | 0 | 0 | 3 | 6 s | 30k |
| correction-and-history · current | 3/3 | 3/3 | 1 | 3/3 | 1 | 6 | 0 | 0 | 6 s | 30k |
| correction-and-history · current-after-restart | 3/3 | 3/3 | 1 | 3/3 | 1 | 6 | 0 | 0 | 6 s | 31k |
| correction-and-history · previous | 3/3 | 3/3 | 1 | 3/3 | 2 | 0 | 0 | 0 | 5 s | 31k |
| chief · bot-result | 3/3 | 3/3 | 1 | 3/3 | 1 | 0 | 0 | 0 | 7 s | 26k |
| chief · own-earlier-chat | 3/3 | 3/3 | 1 | 3/3 | 1 | 0 | 0 | 0 | 6 s | 26k |
| chief · bot-result-after-restart | 3/3 | 3/3 | 1 | 3/3 | 1 | 0 | 0 | 0 | 7 s | 26k |
| chief · own-earlier-chat-after-restart | 3/3 | 3/3 | 1 | 3/3 | 1 | 0 | 0 | 1 | 6 s | 26k |
| crowded-memory · code-among-many | 3/3 | 3/3 | 1 | 3/3 | 1 | 0 | 0 | 21 | 4 s | 30k |
| crowded-memory · corrected-among-many | 3/3 | 3/3 | 1 | 3/3 | 1 | 3 | 0 | 18 | 6 s | 31k |
| crowded-memory · only-in-a-past-run | 3/3 | 3/3 | 2 | 3/3 | 3 | 0 | 0 | 17 | 7 s | 31k |
| crowded-memory · previous-among-many | 3/3 | 3/3 | 2 | 3/3 | 8 | 0 | 0 | 36 | 6 s | 31k |
| crowded-memory · membership-among-many | 3/3 | 3/3 | 1 | 3/3 | 1 | 0 | 0 | 21 | 4 s | 31k |
| crowded-memory · near-miss-unknown | 3/3 | 3/3 | 3 | – | – | 0 | 0 | 76 | 10 s | 32k |

**Overall: 60/60 correct.**

## Taking in what they were told

- Saved the fact as a note when asked: 9/9.
- Saved the correction: 3/3; by updating the same note (so its history keeps the old value): 3/3.
- Pinned the note, which puts it in every prompt (the test unpinned it, so the questions exercise recall): bots, asked not to pin it, 0/6; the Chief 3/3.
## What this baseline says

The phase 3 retrieval changes are measured against it (issue #10). Evidence for every question (prompt, answer, tool calls with their inputs, the records recall returned and what each held, time and tokens) is in [memory-baseline-2026-09-28.json](memory-baseline-2026-09-28.json). Re-render this report with `node test/live/report.js docs/memory-baseline-2026-09-28.json`; run the conversations again with `BOT_DOT_TEST_LIVE_CLAUDE=1 npm run test:live` (see the top of `test/live/memory-conversations.test.js`).

- **Answers: 60/60 right.** Every scenario works, including the crowded memory (209 searchable notes and 120 past runs full of near misses, some facts corrected): the right code among 63 codes, a corrected password, a phone number that is only in a past run, a value from before a change, and "don't know" when only near misses exist. Recall never returned anything off-limits. Phase 3 has to keep all of this.
- **Where ranking falls short (crowded memory).** Of 219 records recall returned there, 21 held the answer and 189 held nothing asked about. The answer came first for simple lookups, but third for the fact that is only in a past run, and eighth (last) for the value from before a change: the earlier version ranks below every current note that shares its words. The bot compensated with more searches: 2 for those two questions, 3 for the unknown one (which gathered 76 irrelevant records over 3 runs), against 1 for the others.
- **Outdated records.** Every question about a corrected fact got the old version back, and usually the run where the old value was first told (6 per question type over 3 runs in the small scenario). The bots answered with the current value, but sort it out themselves.
- **Cost of a question.** Context: 30k tokens at the median (40k for the long answer, 26k for the Chief), barely affected by what recall returns. Time: 6 s at the median, 13 s at most.
- **Not recall, but memory.** In this run bots saved every fact and every correction as asked (9/9, 3/3, all corrections as updates of the same note). In an earlier run of this suite the same day, one bot didn't save a fact it was asked to remember and another saved a correction as a new note, so these can fail. The Chief pinned every fact it was told (3/3), which puts it in every later prompt. These belong to the prompts that tell bots and the Chief how to remember, not to retrieval.
- **Limits.** Meaning search was off; facts are short made-up codes; 3 runs per scenario.
