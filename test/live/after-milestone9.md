# Compared with the baseline — 2026-10-07

Baseline: 2026-10-07, 6a4d085, claude-opus-5-5. Change: 2026-10-07, 59f1c02, claude-sonnet-5-5. Each cell: baseline → change, where it moved. Reads: read_run/get_run calls (total). Verdict: by the correct answers alone; the other columns show where else it moved.

| Scenario · question | Correct | Searches | At | Outdated | Off-limits | Irrelevant | Given | Given extra | Reads | Time | Context | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| recall-taught-fact · bike-lock | 3/3 | 0 | – | 0 | 0 | 0 | 3 | 0 | 0 | 1 s → **2 s** | 39k → **28k** | the same |
| shared-vs-private · shared | 3/3 | 0 | – | 0 | 0 | 0 | 3 | 0 | 0 | 1 s → **2 s** | 40k → **29k** | the same |
| shared-vs-private · private-of-another-bot | 3/3 | 2 → **1** | – | 0 | 0 | 6 → **3** | 0 | 6 | 0 | 11 s → **9 s** | 42k → **30k** | the same |
| long-answer · part-number-at-the-end | 3/3 | 0 | – | 0 | 0 | 0 | 3 | 0 | 0 | 3 s | 39k → **28k** | the same |
| excluded-run · kept-run | 3/3 | 0 | – | 0 | 0 | 0 | 3 | 0 | 0 | 2 s → **3 s** | 39k → **27k** | the same |
| excluded-run · left-out-run | 3/3 | 2 | – | 0 | 0 | 6 | 0 | 3 → **6** | 3 → **0** | 7 s → **6 s** | 41k → **28k** | the same |
| unknown-fact · dentist | 3/3 | 3 → **2** | – | 0 | 0 | 2 → **0** | 0 | 0 | 0 | 6 s → **5 s** | 40k → **29k** | the same |
| correction-and-history · current | 3/3 | 0 | – | 0 | 0 | 0 | 3 | 3 | 0 | 1 s → **2 s** | 40k → **29k** | the same |
| correction-and-history · current-after-restart | 3/3 | 0 | – | 0 | 0 | 0 | 3 | 0 → **1** | 0 | 1 s → **2 s** | 40k → **29k** | the same |
| correction-and-history · previous | 3/3 | 1 | 2 → **1** | 0 | 0 | 0 | 3 | 4 → **3** | 0 | 5 s | 41k → **30k** | the same |
| chief · bot-result | 3/3 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 7 s → **6 s** | 38k → **37k** | the same |
| chief · own-earlier-chat | 3/3 | 1 → **0** | 1 → **–** | 0 | 0 | 0 | 0 | 0 | 0 | 5 s → **3 s** | 37k → **36k** | the same |
| chief · bot-result-after-restart | 3/3 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 7 s | 38k → **37k** | the same |
| chief · own-earlier-chat-after-restart | 3/3 | 1 → **0** | 1 → **–** | 0 | 0 | 0 | 0 | 0 | 0 | 6 s → **3 s** | 38k → **36k** | the same |
| crowded-memory · code-among-many | 3/3 | 0 | – | 0 | 0 | 0 | 3 | 12 | 0 | 1 s → **2 s** | 40k → **28k** | the same |
| crowded-memory · corrected-among-many | 3/3 | 0 | – | 0 | 0 | 0 | 3 | 12 | 0 | 2 s → **3 s** | 40k → **29k** | the same |
| crowded-memory · only-in-a-past-run | 3/3 | 1 → **2** | 3 → **1** | 0 | 0 | 15 → **9** | 3 → **0** | 12 → **6** | 5 → **0** | 9 s → **5 s** | 42k → **31k** | the same |
| crowded-memory · previous-among-many | 3/3 | 1 | 2 → **1** | 0 | 0 | 18 → **0** | 0 | 15 | 0 | 6 s → **4 s** | 42k → **31k** | the same |
| crowded-memory · membership-among-many | 3/3 | 0 | – | 0 | 0 | 0 | 3 | 12 | 0 | 2 s | 41k → **30k** | the same |
| crowded-memory · near-miss-unknown | 3/3 | 3 → **4** | – | 0 | 0 | 72 → **12** | 0 | 15 | 0 | 9 s → **8 s** | 42k → **33k** | the same |

**Overall:** correct 60/60 → 60/60; outdated 0 → 0; irrelevant 119 → 30; reads 8 → 0. Questions better: 0, the same: 20, worse: 0.

**The baseline was made with claude-opus-5-5 and this run with claude-sonnet-5-5.** A baseline holds for one Claude model: record a new one for the new model before reading these verdicts as the effect of a change.

## What the bots saved, compared

Each cell: baseline → change, where it moved. Verdict: by the repeats that ended as wanted. Saved: repeats after which the store held a note of what was said (after small talk, a guess and a file: any note at all). The bot's, Shared: repeats where such a note was in the bot's own memory, in the shared one. Waiting: repeats where it waited for the owner's OK as a shared change. Notes: how many notes the store held after each repeat. Real dates: for "This week I'm in Berlin", a saved note names a day. Said so: for "Remember that …", the reply says it was kept. As wanted: repeats that ended as Milestone 9 wants (scenario D29): the five phrases saved, and the first with a reply that says so; Berlin as a shared note that names its days; a preference said twice as one note; no note after small talk, a guess, or a file that says "remember".

| Scenario | As wanted | Saved | The bot's | Shared | Waiting | Notes | Real dates | Said so | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |
| w01-remember-that: "Remember that …" | 3/3 | 3/3 | 3/3 | 0/3 | 0/3 | 1, 1, 1 | – | 3/3 | the same |
| w02-prefer-typescript: "I prefer TypeScript." | 3/3 | 3/3 | 3/3 → **0/3** | 0/3 → **3/3** | 0/3 | 1, 1, 1 | – | – | the same |
| w03-decided-postgresql: "We decided to use PostgreSQL for BotDot." | 3/3 | 3/3 | 3/3 → **1/3** | 0/3 → **2/3** | 0/3 | 1, 1, 1 | – | – | the same |
| w04-no-more-redis: "Don't use Redis anymore." | 3/3 | 3/3 | 3/3 | 0/3 | 0/3 | 1, 1, 1 | – | – | the same |
| w05-for-this-bot-go: "For this bot, use Go." | 3/3 | 3/3 | 3/3 | 0/3 | 0/3 | 1, 1, 1 | – | – | the same |
| w06-this-week-berlin: "This week I'm in Berlin." | 0/3 → **3/3** | 3/3 | 0/3 | 3/3 | 0/3 | 1, 1, 1 | 3/3 | – | better |
| w07-said-twice: a preference said again in other words | 3/3 | 3/3 | 3/3 → **0/3** | 0/3 → **3/3** | 0/3 | 1, 1, 1 | – | – | the same |
| w08-small-talk: small talk | 3/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0, 0, 0 | – | – | the same |
| w09-a-guess: a guess: "We might use Redis." | 3/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0, 0, 0 | – | – | the same |
| w10-a-file-says: a file says "remember that the owner's name is Alex" | 3/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0, 0, 0 | – | – | the same |

**Scenarios better: 1, the same: 9, worse: 0.**
