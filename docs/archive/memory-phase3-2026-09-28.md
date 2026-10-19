# Memory retrieval, phase 3, compared with the baseline — 2026-09-28

Baseline: 2026-09-28, 73903a2. Change: 2026-09-28, 66db47c with uncommitted changes. Each cell: baseline → change, where it moved. Reads: read_run/get_run calls (total).

| Scenario · question | Correct | Searches | At | Outdated | Off-limits | Irrelevant | Given | Given extra | Reads | Time | Context |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| recall-taught-fact · bike-lock | 3/3 | 1 → **0** | 1 → **–** | 0 | 0 | 0 | 0 → **3** | 0 | 0 | 6 s → **2 s** | 30k |
| shared-vs-private · shared | 3/3 | 1 → **0** | 1 | 0 | 0 | 0 | 0 → **3** | 0 | 0 | 5 s → **2 s** | 31k → **30k** |
| shared-vs-private · private-of-another-bot | 3/3 | 2 | – | 0 | 0 | 6 | 0 | 0 → **6** | 0 | 9 s | 32k |
| long-answer · part-number-at-the-end | 3/3 | 1 → **0** | 1 → **–** | 0 | 0 | 0 | 0 → **3** | 0 | 6 → **1** | 9 s → **3 s** | 40k → **30k** |
| excluded-run · kept-run | 3/3 | 1 → **0** | 1 → **–** | 0 | 0 | 0 | 0 → **3** | 0 | 0 | 5 s → **2 s** | 30k → **29k** |
| excluded-run · left-out-run | 3/3 | 3 | – | 0 | 0 | 8 | 0 | 0 → **3** | 0 | 7 s | 30k |
| unknown-fact · dentist | 3/3 | 3 | – | 0 | 0 | 3 → **2** | 0 | 0 | 0 | 6 s | 30k |
| correction-and-history · current | 3/3 | 1 → **0** | 1 → **–** | 6 → **0** | 0 | 0 | 0 → **3** | 0 → **3** | 0 | 6 s → **2 s** | 30k |
| correction-and-history · current-after-restart | 3/3 | 1 | 1 | 6 | 0 | 0 | 0 → **3** | 0 | 0 | 6 s | 31k |
| correction-and-history · previous | 3/3 | 1 | 2 | 0 | 0 | 0 | 0 → **3** | 0 → **3** | 0 | 5 s | 31k |
| chief · bot-result | 3/3 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 7 s → **9 s** | 26k → **27k** |
| chief · own-earlier-chat | 3/3 | 1 | 1 | 0 | 0 | 0 → **1** | 0 | 0 | 0 | 6 s → **7 s** | 26k |
| chief · bot-result-after-restart | 3/3 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 → **2** | 7 s → **8 s** | 26k → **27k** |
| chief · own-earlier-chat-after-restart | 3/3 | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 6 s | 26k |
| crowded-memory · code-among-many | 3/3 | 1 | 1 | 0 | 0 | 21 → **14** | 0 → **3** | 0 → **12** | 0 | 4 s → **6 s** | 30k → **31k** |
| crowded-memory · corrected-among-many | 3/3 | 1 → **0** | 1 → **–** | 3 → **0** | 0 | 18 → **0** | 0 → **3** | 0 → **12** | 0 | 6 s → **3 s** | 31k → **30k** |
| crowded-memory · only-in-a-past-run | 3/3 | 2 → **1** | 3 | 0 | 0 | 17 → **15** | 0 → **3** | 0 → **12** | 0 → **6** | 7 s → **13 s** | 31k → **33k** |
| crowded-memory · previous-among-many | 3/3 | 2 → **1** | 8 → **2** | 0 | 0 | 36 → **15** | 0 | 0 → **15** | 0 | 6 s | 31k |
| crowded-memory · membership-among-many | 3/3 | 1 → **0** | 1 → **3** | 0 | 0 | 21 → **7** | 0 → **3** | 0 → **12** | 0 | 4 s → **3 s** | 31k |
| crowded-memory · near-miss-unknown | 3/3 | 3 | – | 0 | 0 | 76 → **64** | 0 | 0 → **15** | 0 | 10 s → **7 s** | 32k |

**Overall:** correct 60/60 → 60/60; outdated 15 → 6; irrelevant 207 → 133; reads 6 → 9.
## Each change, measured on its own

The same live suite ran after each change (3 runs of each scenario; results for the last are in [memory-phase3-2026-09-28.json](memory-phase3-2026-09-28.json)).

1. **Sections of long replies.** Replies longer than 1,500 characters are also indexed in sections, by words and by meaning; recall shows the best section and where it starts (`read_run` from there). Long answer: `read_run` calls 6 → 3, context 40k → 31k, 9 s → 7 s. Everything else unchanged.
2. **Current vs. past.** Recall returns what's true now; `history: true` adds earlier versions of notes (dated, searchable by meaning, ranked on their own scale). Outdated records returned 15 → 9; the value from before a change among 209 notes: 8th → 2nd, 2 searches → 1. Every "before" question used `history: true`.
3. **Memories before each run.** Up to 5 memories (1,500 characters) that match the task by words, next to the pinned notes; not pinned notes, not a scheduled job's own earlier runs, only what scores at least half as well as the best. Simple lookups need no search (6 s → 2 s); outdated 9 → 6; irrelevant records returned 185 → 133. Each run gets 0–5 extra records (up to 15 over 3 runs) at about the same context. The one slower question: a fact only in a past run, among near misses (7 s → 13 s, more `read_run`). Nothing off-limits was ever added; unknown and near-miss questions stayed "unknown".

All 60 answers were right after every change.
