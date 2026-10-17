# Architecture improvement plan

Status: done. All four steps are in; the parked items below wait for a reason to come back.

Date: 27 September 2026. Based on the [architecture review](architecture-review-2026-09-27.md). An earlier, much larger version of this plan (eleven packages, SQLite operational store, shared schemas for four clients) was dropped; this version keeps its diagnosis and cuts it down to what a private, single-owner app needs now.

## What this plan is for

bot·dot is one server on one VM with one owner. The review found one real bug (work the queue says it accepted can be lost) and several large files that are getting harder to change. This plan fixes the bug properly and makes two cheap improvements. Everything else waits until it causes an actual problem.

Rules for every step:

- Each step is its own branch and its own change. No file moves mixed in with behaviour changes.
- Before building a step, I send a short plan for that step and wait for approval.
- After building, I run the local test setup (one scratch botdot server on this Mac, the Android emulator with the debug app connected to it), send what changed and how to test it, and commit only after the owner says it's OK.
- Web and Android only. The Mac app was not touched; the Linux GUI app present during this work has since been removed.
- No new screens, buttons or explanations in the UI. Anything the owner needs to see goes through what already exists (bot chats, the "Waiting for your OK" dots, the Chief).

## Step 1 — The queue tells the truth

**Problem.** A bot runs one AI run at a time; other work waits in a queue of at most ten per bot ([lib/bots.js:866](../lib/bots.js#L866)). When the queue is full, `enqueue` logs a warning and drops the work, but its caller still reports it as queued. Seen in a reproduction: 12 priority messages all answered `queued`, only 10 ran. The same path is used by five callers, each with its own loss:

| Caller | Where | What goes wrong today |
| --- | --- | --- |
| Priority message to a teammate | `sendBotMessage` | Sender told `queued`, and starts waiting for an answer that never comes |
| Follow-up with teammates' answers | `startFollowUps` | `awaits.due()` deletes the wait before admission, so the answers are lost |
| Script job handing off to AI | `runScriptJob` | Handoff dropped silently |
| Scheduled or "Run now" job | `runJob` / `tick` | A one-time job is removed from the bot even though it never ran |
| Memory review | `startReview` | Dropped silently (harmless: the next review catches up) |

**What changes.**

1. `startOrQueue` returns one of `started`, `queued`, `already_queued`, `full`. Duplicate check stays before the capacity check (a job already waiting is `already_queued`, not `full`).
2. Each caller handles `full`:
   - Priority message: goes to the bot's inbox instead (decision A). No sender wait is created for it.
   - Follow-up: `awaits.due()` only removes a wait after its follow-up was accepted; otherwise it stays and is retried on the next check.
   - Script handoff: logged, and the error is recorded on the job's state, where it already shows.
   - Memory review: "Review now" answers with an error; a scheduled review is logged and caught up by the next one.
   - "Run now" on a job: answers with an error saying the bot has too much waiting.
   - Scheduled job: a one-time job stays in the bot's jobs and is retried every minute until it is accepted; it is removed only once it has started or been queued. A recurring job's missed occurrence is logged and recorded on the job's state.
3. The update check counts queued work as busy ([lib/updates.js](../lib/updates.js) `busy()`), so an update doesn't restart the server and lose the queue. (Step 2 makes this matter less, but it ships first.)

**Tests.** Automated: fill a busy bot's queue with 12 messages and check that 10 run, 2 get `full`, and no stray waits exist; a full queue keeps a one-time job and a ready follow-up; a duplicate job is `already_queued` even when full. Full `npm test` after.

**How the owner checks it.** Hard to trigger by hand, so I'll provide a small script that fills a test bot's queue on the scratch server. The owner then sees the extra messages land in the busy bot's inbox (in the test bot's chat on web and Android), and a one-time job that couldn't start still listed under the bot's jobs.

## Step 2 — Queued work survives a restart

**Problem.** The queue is a JavaScript `Map` of closures. Any restart loses it, and the most common restart is an update from the settings page.

**What changes.**

1. Queue items become plain data instead of closures: `{ id, botId, key, kind, params, queuedAt }`, where `kind` is one of `message`, `replies`, `script-followup`, `job`, `review` and `params` holds what `startRun` needs (prompt, fromBot, wait, job id, parent run id).
2. The queue is saved to `data/queue.json` with the temp-file-and-rename write the bots file already uses. Every change is saved before the caller is told `queued`.
3. On startup the queue is loaded and each bot's queue drains as usual.
4. When an item's turn comes, it is checked again: bot still exists, job still exists and is approved. If not, it is dropped with a log line and, for a job, an error on the job state.
5. Runs that were already running when the server stopped keep today's behaviour: marked "interrupted" in the bot's chat, not re-run. Re-running could repeat something the bot already did in the outside world.
6. One-time jobs that came due in the last 24 hours while botdot was off run when it starts (decision E). Older ones stay listed as before.
7. Updates warn only about runs in progress again; queued work now survives the restart (decision D).
8. `queue.json` is included in backups. It lives in the data folder, so it is included already. Restore needs no special handling: a restored queue simply runs.

**Left out on purpose.** No SQLite, no separate recovery screen, no pausing restored work, no crash-point matrix. With one server process these add a lot of machinery for cases that practically never happen.

**Tests.** Automated: queue a job and a priority message behind a busy bot, restart the scratch server, check both run once. An item whose bot was deleted or whose job lost approval is dropped. A corrupt `queue.json` is kept aside and reported, not silently emptied.

**How the owner checks it.** On the scratch server, start a slow job on the test bot, press "Run now" on a second job so it queues, then I restart the server. After a restart the second job still runs and shows in the bot's chat on web and Android.

## Step 3 — Safer history files, faster run lists

**Problem.** `listRuns` ([lib/bots.js:321](../lib/bots.js#L321)) opens every run file ever written to return the latest few, and the web app asks for it often. Run metadata, Chief chats, inboxes and waits are written in place, so a crash mid-write can leave a broken file that then reads as empty.

**What changes.**

1. Run file names start with a timestamp (`20260923162934-2a2f1f.json`). `listRuns` sorts file names newest first and stops once it has enough matches, instead of reading and sorting all of them. Same result and same API, much less work as history grows.
2. Run metadata, Chief chats, inboxes (`lib/messages.js`) and waits (`lib/awaits.js`) use the same temp-file-and-rename write as `bots.json`. A small shared helper replaces the half-dozen copies of it.
3. Reading distinguishes a missing file (empty, as now) from a broken one: a broken file is renamed to `*.broken-<time>` and logged, never overwritten with empty data.

**Left out.** No database for runs or chats and no pagination changes. If the VM's history ever makes the Chief's chat list slow, that gets its own small fix.

**Tests.** Automated: `listRuns` returns the same runs as before on a generated history, including a bot filter and equal timestamps; a truncated run file doesn't hide other runs; a broken `awaits.json` is kept aside. The owner check is simply that bot chats and run history look the same as before on web and Android.

## Step 4 — Know which Claude Code the server runs

**Problem.** The Dockerfile installs Claude Code and the Bitwarden CLI without versions (`npm install -g @anthropic-ai/claude-code @bitwarden/cli`). A rebuild can pick up a Claude Code release that changes its options or output, and runs break without a clear reason.

**What changes.** The version is already logged at startup and returned by `/api/setup`, and decision C keeps the latest version. The gap was silent failure: a run that ended without Claude Code's `result` line passed as an empty reply, and a scheduled one was then hidden as quiet. Such a run, or Chief reply, now fails with a plain message naming the Claude Code version and saying botdot needs an update to match. A real quiet run still has an (empty) `result` line and stays quiet. No change to the UI.

## Decisions (approved 27 September 2026)

- **A. A priority message to a bot whose queue is full** goes to that bot's inbox, and the sender is told "it reads this on its next run". Nothing is lost; it just doesn't wake the bot. No sender wait is created for it.
- **B. The ten-per-bot limit** stays at ten until step 1 shows whether it is ever hit.
- **C. Claude Code** keeps taking the latest version. The server logs the version it runs and fails a run clearly when the output format is unexpected.
- **D. Updates** warn only about runs in progress once step 2 is in, since queued work survives the restart.
- **E. One-time jobs missed while botdot was off** run when it starts, if they came due in the last 24 hours.
- **F. A damaged data file** is kept aside and logged only; nothing is shown in the UI.

## Parked, with what would bring them back

| From the earlier plan | Revisit when |
| --- | --- |
| Split `lib/bots.js` into runs, prompts, process, scheduler; explicit app start/stop | The next larger change to runs or scheduling; do the split as its first commit |
| Split `public/app.js` into feature modules, Dashboard first | The next larger Dashboard or chat change |
| Move business logic and policy out of `server.js` into feature modules | Adding a route means touching unrelated code again |
| SQLite store for runs, chats, queue | Step 3 isn't enough for the VM's real history size |
| Browser refresh coordinator (stale responses, lost drafts) | A draft or selection is actually lost in use |
| Shared JSON contracts and fixtures for all clients | Android and the server disagree about a response in practice |
| Mac store and settings splits | The owner resumes work on the Mac app |

## Progress

- [x] Architecture review recorded.
- [x] Plan revised and shortened.
- [x] Owner approves this plan and decisions A–C.
- [x] Step 1 — The queue tells the truth.
- [x] Step 2 — Queued work survives a restart.
- [x] Step 3 — Safer history files, faster run lists.
- [x] Step 4 — Know which Claude Code the server runs.
