# Job schedules in plain words

4 Oct 2026. An improvement report from `/kordal-improve`; no code was changed.

## Question

"Current display of the cron jobs schedule is not very user friendly. How can we improve it?" The owner's screenshot showed the web page's Scheduled jobs card for a job with `0 8-21 * * *`: the raw expression beside the job's name and again in the line under the Schedule field.

## Criterion

The owner confirmed one:

- **Plain words everywhere.** Every schedule a job can have reads as words wherever it is shown (card header, the line under the Schedule field, approval cards), e.g. `0 8-21 * * *` reads "Every hour, 08:00 to 21:00". Raw cron never appears as the description.

Offered and not chosen: editing without cron, one time format, the same on all three apps as its own criterion.

## Observed

A test server with one bot and 11 jobs, web page, the Scheduled jobs list:

| Cron | Shown as |
| --- | --- |
| `0 8-21 * * *` | `0 8-21 * * *` |
| `0 8,12,18 * * *` | `0 8,12,18 * * *` |
| `*/30 9-17 * * 1-5` | `*/30 9-17 * * 1-5` |
| `0 9 * * 1,3,5` | `0 9 * * 1,3,5` |
| `15 * * * *` | Every hour (the :15 is lost) |
| `0 9 * * *` | Daily at 09:00 |
| `30 7 * * 1-5` | Weekdays at 07:30 |
| `*/15 * * * *` | Every 15 min |
| `0 */2 * * *` | Every 2 hours |
| `0 9 1 * *` | Monthly on day 1 at 09:00 |
| `0 20 * * 0` | Sundays at 20:00 |

The monthly job, whose next run was 1 Nov, showed "next Sun".

## Findings

Investigated by the `kordal-investigator` agent; every cited line was opened and confirmed.

1. **Raw cron is the fallback of all three describers.** Each ends by returning the expression: `public/app.js:269`, `android/app/src/main/java/dev/botdot/app/ui/NeedsYouScreen.kt:702`, `macos/BotDotKit/Sources/BotDotKit/Jobs.swift:89`.
2. **Where a schedule is shown.** Web: the card header `public/app.js:2739` and `:2806`, the preview line `:2810`, the approval dialog `:2917`, the toast `:2934`, the Needs-you card `:4298`, the always-approved list in the bot's settings `:4425` (used at `:1235`). Android: `JobsScreen.kt:115`, `BotSettingsScreen.kt:251`, `NeedsYouScreen.kt:561`. Mac: `macos/BotDot/UI/JobsView.swift:105` and `:199`, `BotSettingsView.swift:340`, `macos/BotDotKit/Sources/BotDotKit/Needs.swift:315`. No notification or dashboard tile shows a schedule.
3. **Wrong words on all three.** `15 * * * *` reads "Every hour"; `30 */2 * * *` and `0 */2 * * 1` read "Every 2 hours", the minute and the weekday dropped (`public/app.js:258-259`, `NeedsYouScreen.kt:693-694`, `Jobs.swift:78-79`).
4. **Android's words differ.** It has no preset table, so `0 * * * *` is "Every hour" where web and Mac say "Hourly", and `0 2 * * *` is "Daily at 02:00" where they say "Nightly at 02:00". The comment at `public/app.js:247` ("the same as describeCron on Android") is false. Only the Mac's describer has tests (`macos/BotDotKit/Tests/BotDotKitTests/JobsTests.swift:31-39`).
5. **Any accepted shape can be created.** `lib/cron.js` takes numeric lists, ranges, steps, `5/15` and weekday 7; it refuses names, `@daily` and six fields. The day of the month and the weekday must both match (`lib/cron.js:56-63`). It also accepts a schedule that never runs: `0 21-8 * * *` parses to an empty set of hours. The Chief and the bots are steered by two examples only (`lib/mcp-server.js:123`, `lib/self-mcp.js:39`).
6. **The Chief reads raw cron and is told to say it in words** (`lib/mcp-server.js:39`, `lib/chief.js:113`); `lib/mentions.js:28` puts `schedule <cron>` in a note only the model reads.
7. **The toast lower-cases the words** (`public/app.js:2934`): "will run mondays at 10:00".
8. **"next Sun" for a run weeks away.** `now - d < 6 days` is always true for a date in the future (`public/app.js:509`, `macos/BotDotKit/Sources/BotDotKit/Format.swift:21`). Android is right (`Components.kt:178-184`).
9. **The server already decorates every job** (`jobView`, `server.js:286-289`) and answers `POST /cron/preview` (`server.js:755`). One file shared by the page and the server exists as a pattern: `lib/mentions.js:3` requires `public/mentions.js`.
10. **Specified once before.** Issues Kordal/bot-dot#170 (web), #173 (Mac) and #174 (Android) reached `ready-for-dev`, then were closed as not planned on 3 Oct 2026 at 11:18 UTC with 21 others in the same minute and no comment. The owner's decision on #170: "Do all platforms, read-only plain words with custom option to edit". #170 holds a 40-row wording table and the fallbacks "Custom schedule" and "Invalid schedule"; it kept a describer in each app. Its row for `0 8-18 * * 1-5` ("11 times a day, from 08:00 to 18:00, Monday to Friday") contradicts this report's criterion ("Every hour, 08:00 to 21:00"). No ADR, product document or plan covers schedule wording.

## Proposals and verdicts

| # | Proposal | Size | Verdict |
| --- | --- | --- | --- |
| 1 | The server says every job's schedule in words (a field on each job and in the cron preview), and the page and both apps show those words wherever a schedule appears. | Feature, 3 tasks: the server and a wording fixture, the web page, Android and the Mac | **Now** |
| 2 | A schedule nothing can describe reads "Custom schedule", never cron; `15 * * * *` no longer reads "Every hour". | Quick on its own | **Now, inside 1**: each app's fallback for a server that sends no words |
| 3 | "next" shows the date when the run is more than six days away, on the web page and the Mac. | Quick | **Now** |
| 4 | Fix the three describers separately against one shared wording table (the plan of #170). | Feature, 3 tasks, large | **No**: proposal 1 replaces it; three copies cost more and drift again (the recommendation's reason, which the owner accepted without adding one) |

Recommended and chosen: proposal 1. One describer follows ADR 003 and ends the Android drift; `jobView` is where the words are added, announced in `features` and written in `docs/api.md`.

For the plan of proposal 1:

- Take #170's wording table as the fixture, with the hour-range rows changed to the form "Every hour, 08:00 to 21:00".
- Fallbacks: "Custom schedule" for a valid schedule the rules cannot say, "Never runs" for one that cannot match, "Invalid schedule" for bad input.
- The approval toast must not lower-case the words.
- The words are in the server's time zone and 24-hour time; the Mac's live line while typing waits on the preview call.

## Already fine

- The seven presets and the six shapes described correctly today.
- One-time jobs ("28 Sep at 07:00").
- The "Next:" preview and `POST /cron/preview`.
- Cron parsing in `lib/cron.js` and the stored format.
- The Chief's instruction to say schedules in words.
- The cron text field as the editor: no schedule builder was asked for.
