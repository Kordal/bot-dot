# Milestone 7 research: busy and stopped

Planning status: stage 6 closed on 2026-10-06; next: delivery, starting with BUSY-001 or BUSY-006.

Date: 2026-10-06. Revision inspected: `main` at `ee91cb3` (Milestone 6 is merged through pull request 249, and the four fixes of its release run through pull requests 250 to 253). `node scripts/agent-local.mjs phase` prints `between`: every task is done, and `docs/plans/planned/` and `active/` are empty. No product tests were rerun and no product was started. This note is research evidence, not an implementation plan.

## Why this milestone

On 2026-10-06 the owner asked what [the interaction audit](../../product/improvements/2026-10-05-bot-interaction-audit.md) still leaves open, and then to plan Milestone 7. [Milestone 5](../../product/milestone5.md) delivered its quick wins and [Milestone 6](../../product/milestone6.md) its two critical findings. Milestone 6 excluded "one rule for a busy bot or Chief": the owner's own message is still refused by a replying Chief and still starts a second run of a busy bot, and a late result still arrives as the bot's raw message. That exclusion, the audit's finding 4, is the largest finding still open. The combination proposed to the owner before this planning was "Busy and stopped": one rule for busy, Stop that stops what it started, a late result as a Chief turn, and the audit's failure hygiene (finding 9, structural change 8).

## What the product delivers today

After Milestone 6 an OK carries on what it interrupted, a connected-app action waits inside its run, and work that carries on waits in the bot's queue or, for the Chief, in a list of waiting turns kept on disk.

Each finding below was looked up again at `ee91cb3` on 2026-10-06 by three readers, each given the audit's claim and told to report it as holding, changed or gone. All hold unless the table says otherwise.

### Busy

| Area | Verified at `ee91cb3` |
| --- | --- |
| A busy Chief refuses | `send()` throws "The Chief is still replying" (`lib/chief.js:438`), a 400 at the catch-all (`server.js:2044`). The message keeps its key (`server.js:1566`) |
| What the apps do | Normally neither app sends: the one button is Stop while the Chief replies (web `public/app.js:2166-2174`, `2135`; Android `ui/Components.kt:626-627`). A refusal that does arrive puts the text back with "Not sent: The Chief is still replying." (`app.js:2071-2077`, `ChatModels.kt:494-506`) |
| The web page does not know the Chief started by itself | It learns "busy" from loading the chat and from its own send only; it does not listen to `chief_started` (`app.js:5706`). A turn botdot starts after an OK leaves Send showing, and the owner's message gets the 400 (inferred). Android refreshes on that event (`data/Store.kt:146`) |
| The Chief waits inside its turn | `wait_for_run` waits 240 s, at most 540 s (`lib/mcp-server.js:630-632`). Its instructions: "run_bot, then wait_for_run to report the outcome" (`lib/chief.js:23`, `35`), and when the wait ends, "say so in one line: its reply will show up in this chat by itself" (`:36`) |
| A Chief turn cannot take a message | One process per turn, one prompt on stdin, closed at once (`lib/chief.js:500`, `517`, `662`). No `--input-format` anywhere in `lib/` |
| A busy bot forks | The owner's message and the Chief's `run_bot` call `startRun` with no check (`server.js:1712`, `lib/bots.js:768`); a Board tile does the same (`server.js:76`). The second run's history leaves running runs out (`lib/bots.js:580`). `docs/api.md:121` records it as intended: "a bot can have two runs going" |
| The apps on a busy bot | Web page: always Send (`app.js:2610`); Stop is the faint word at the end of the status line (`public/opening-line.js:30`). Android: the one button is Stop for any running run, a job's too (`BotChatScreen.kt:134`, `Components.kt:626-627`); no send path. The server forks for any client |
| The bot's queue | `startOrQueue` holds 10 items per bot in `data/queue.json`, first in, first out (`lib/bots.js:1353`, `1442`, `1450`). Kinds: a teammate's message, replies, a job, a script's follow-up, a carry-on (new in Milestone 6), a review (`:1401-1434`). Never the owner's message. Loaded at start and drained when a run ends (`:1370`, `:1045`, `:1447`). A full queue answers `'full'`, and each caller copes in its own way |
| The Chief's waiting turns | **Changed:** on disk since Milestone 6 (`data/chief-waiting-turns.json`, `lib/chief.js:679-682`). Items are `{ prompt, message, otherwise, title, at }` (`:725`), added only for turns botdot starts (`:724-728`), started when the reply ends (`:658`). No cap on count; dropped after 24 hours, checked at start only (`:680`, `:695-703`) |
| Nothing shows what waits | No route and no feed event reads either queue. Fragments: "it carries on when it is free" in a yes's answer (`server.js:261`, `310`), `{ queued: true }` from "Run now" and a review (`lib/bots.js:1882`, `2014`), `delivered: "queued"` on a bot's message (`:1545`). No `queued` run status, no count on the bot |
| "Run now" | The web page says "It will run as soon as the bot is free" (`app.js:3055`). Android says "Started" and discards the answer (`ui/JobsScreen.kt:89`, `data/Api.kt:153`). On a script still running the answer is `{ started: 'script' }` though it was skipped (`lib/bots.js:1874-1875`; inferred) |

### Stop

| Area | Verified at `ee91cb3` |
| --- | --- |
| Stop in the Chief's chat | Kills the Chief's process only, SIGTERM with no SIGKILL after it (`lib/chief.js:1036-1042`; a bot run has one, `lib/bots.js:1128`). The bot it started runs on |
| What links a Chief turn to its runs | The turn's reply keeps `actions` of kind `run` with `botId` and `runId` for `run_bot` and `run_job` (`lib/chief.js:407`, `417`), indexed for `chatThatStarted` and `chatOfRun` (`:269-285`). The run keeps `startedBy: 'chief'` and no chat (`lib/bots.js:956`); a run of `run_job` has no `startedBy` (`:1405`) |
| Stop empties nothing | A stopped run's `finish` starts the bot's next waiting item at once (`lib/bots.js:1045`); a stopped Chief turn starts its next waiting turn (`lib/chief.js:658`) |
| Who stopped | Not recorded: `stopRequested` becomes `status: 'stopped'` and is deleted (`lib/bots.js:1125`, `1015`, `1020`). `actor(req)` exists at the route and is not kept (`server.js:1766`, `1907`) |
| Who can stop | A bot run: the owner in either app, the Chief's `stop_run` (`lib/mcp-server.js:656-659`), and a sign-out of Claude (`server.js:775`). A Chief turn: the owner, and a sign-out. All read "You stopped this run before it finished." (`lib/problems.js:7`) or "You stopped this reply." (`lib/chief.js:394`). **Narrower than the audit:** a restart reads "cut off because botdot was restarted" (`problems.js:8`), and a bot with a run cannot be deleted (`server.js:1610`) |
| `stopped` means "the owner did it" in three rules | No late report to the Chief (`lib/bots.js:1743`), no carry-on (`lib/asks.js:478`, `522`), the connected-app card goes (`lib/connector-approvals.js:186`). The Chief's `stop_run` and a sign-out inherit all three today |
| Android on a stopped run | "Stopped." in muted text; the server's sentence is ignored (`ui/BotChatScreen.kt:226`) |

### A late result

| Area | Verified at `ee91cb3` |
| --- | --- |
| How it arrives | A `report` message pushed into the Chief's chat, drawn as "Message from <bot>", with no Chief turn (`lib/bots.js:1742-1745`, `lib/chief.js:821-841`, `app.js:2270`). The Chief reads it with the owner's next message (`chief.js:459`, `471`). While the Chief replies it is held and re-checked after (`:834`, `:652`) |
| Against `tell` | `tell` (`startTold`, `lib/chief.js:715-751`), which a tool install and a Milestone 6 OK use, pushes the same bubble and starts a turn or queues it. It does not fit as it is: it drops `files` and the failure mark, it has no check that the Chief already read the result in the same turn (`chiefSaw`), and a turn that starts a run whose late result starts a turn has no bound (inferred) |

### Failures

| Area | Verified at `ee91cb3` |
| --- | --- |
| A failing job, every run | A failed scheduled run is never held: `finishReport` returns before quiet hours are looked at (`lib/reporting.js:21`). The feed marks it `new` (`lib/bots.js:560-566`, `lib/read.js:31`), and the phone notifies exactly when the feed says `new` (`feed/Notifier.kt:633-634`). Nothing is de-duplicated across runs. The web page has no notifications; it shows the dot, "Couldn't finish" and the failed face |
| Quiet hours | 22 to 7 by default, set only through the Chief (`lib/reporting.js:2-4`, `server.js:975-977`). They hold back a non-urgent report of a successful scheduled run and the Chief's look, nothing else. Held reports go out on the first tick after (`lib/bots.js:1261-1273`). Android shows the raw word "held" for such a job (`ui/JobsScreen.kt:124`) |
| No time limit | A bot run, a Chief turn and a memory review have none (`lib/bots.js:1049-1118`, `lib/chief.js:522-527`). botdot sets Claude's limit for one tool call: 15 minutes for a bot, 10 for the Chief (`lib/bots.js:1053`, `lib/chief.js:522`). A script job has 300 s by default (`lib/jobs.js:62`); a look 5 minutes (`lib/chief.js:921`) |
| A job that did not run | A repeating job's minute that passes while botdot is down leaves nothing and is not caught up (`lib/bots.js:1892-1896`). A script still running is skipped with a console line only (`:1812`). The same job already waiting merges silently (`:1440`). A full queue and dropped work do store a sentence in the job's state (`:1881`, `:1453-1455`), which reaches the apps as `last.error` (`server.js:499`) and is drawn by neither: the web page shows "failed" (`app.js:2905`), Android's model has no such field (`data/Models.kt:37`), and the Chief's summary strips it (`lib/mcp-server.js:42`) |
| Claude signed out | Detected and sent as a `claude` feed event and in `hello` (`lib/setup.js:48-64`, `server.js:1879-1897`); neither app draws it. The scheduler has no check, so every due job fails, counts as new and rings (`lib/bots.js:1892-1923`). The web page opens Setup on page load only (`app.js:5796-5799`) |
| Raw errors | The catch-all answers any thrown error's message as a 400, unlogged (`server.js:2044`). Most of these are sentences written for the owner; a blanket generic message would erase them |
| End-state words | The server writes the problem sentence (`lib/problems.js`); each app writes the rest: "Couldn't finish" or "Stopped" in the list, "Done. (No written reply.)" or "Done." for an empty reply (`app.js:643`, `1844`; `ui/HomeScreen.kt:497-498`, `BotChatScreen.kt:224`). The web page keeps a second copy of the server's table (`app.js:1734-1748`). The table matches on the reply's text too, so a failed script whose output holds "429" or "/login" gets Claude's sentence (`problems.js:6`; inferred) |
| A Board tile that asks a bot | "Asked X" for 2.5 seconds; nothing reads the `runId` after (`app.js:5277`, `ui/DashboardScreen.kt:115`). **Changed:** a switch whose action failed is re-read and both apps show the error (`lib/dashboard.js:469`) |

### What the agreed design says

MSG-013, accepted by the owner on 2026-10-02: "Stop sits at the end of the status line on the web page and the Mac, as the faint word "Stop" right after the text … Android keeps its Stop in the message box and gains none", and "Unchanged: … the Chief's chat". So the web page's bot chat already has Send beside Stop. Send beside Stop is new on Android, in both chats, and in the web page's Chief chat.

## Evidence boundaries

- Every code fact above was read by an agent on 2026-10-06 and not exercised: no server was started and no message was sent.
- What the Chief does when a wait ends, and whether it summarises a late result well, is model behaviour.
- How often the owner writes to a working bot or a replying Chief, and how often a job fails several times in a row, is not measured. Real use of Milestone 5 (A20) and Milestone 6 (A20) on the owner's own server is still open, so nothing here rests on daily use.
- Sizes are the auditors' estimates and this session's reading.
- Other products' behaviour comes from their documentation, not from use.
- The audit did not cover the first run and pairing, updates and backups, and several Android settings screens.

## Evidence and candidate improvements

| Evidence | Candidate improvement |
| --- | --- |
| A replying Chief refuses and a busy bot forks; a queue exists for everything except the owner (verified). Four products queue (documentation, Milestone 6 note). | One rule on the server: the owner's message is taken, kept on disk, and starts when the bot or the Chief is free. A Board tile and the Chief's `run_bot` follow the same rule. |
| Nothing shows what waits; "Run now" on Android says "Started" (verified). | What waits is data the server hands out: the apps draw the owner's waiting message, and it can be taken back into the box. |
| The message box differs: Send on the web page's bot chat, Stop everywhere else (verified). | Send stays available while the bot or the Chief works, with Stop beside it. An owner decision on a prototype, since it changes MSG-013 on Android and in the Chief's chat. |
| Stop in the Chief's chat leaves its bot running; Stop empties no queue (verified). The turn already records the runs it started. OpenClaw defines Stop for the whole tree (documentation). | Stop in the Chief's chat stops the runs that turn started. What Stop does to the owner's waiting messages is an owner decision. |
| The Chief waits up to nine minutes inside its turn, and a late result is a raw bubble with no turn (verified). Claude Code and OpenClaw give the parent a turn (documentation). | A shorter wait; a late result becomes a short Chief turn marked as not from the owner, with a bound. With a queue, the nine minutes hurt less: this may give way. |
| Who stopped a run is not recorded; three rules read `stopped` as the owner's doing (verified). | The stopper is kept with the run, the sentence is worded from it, and the three rules ask who stopped. |
| A failing job rings every run, also at night; no product read documents quiet hours for failures, three alert once per streak (verified; documentation). | A failure is said once per streak and held through quiet hours; a job that recovers is silent. |
| Claude signed out fails every job, each as a new failure; the apps ignore the `claude` event (verified). | One standing line in both apps; due jobs are not run, and say why. |
| A bot run has no time limit (verified). Claude Code already ends a silent model or tool; OpenClaw caps a scheduled run at 60 minutes (documentation). | A total limit for a run nobody is watching, with its own sentence. |
| A job that did not run leaves no reason, or a reason no app draws (verified). Claude Desktop and OpenClaw list a skipped run with its reason (documentation). | Every job that did not run stores why, and both apps draw it under the job. |
| End-state words are written three times (verified). | Borders on "a shared voice and progress words written on the server", excluded twice by the owner. Only where a new state needs a word. |

## Carried forward

- Milestone 6: real use (A20) on the owner's server; the low findings under Follow-up of [milestone6-test.md](../../product/milestone6-test.md). Those that touch the candidates: two requests of the owner that overlap in time can both carry on; Allow tapped while the owner's request is still running starts nothing; a stopped connected-app card stays when the owner writes in the Chief's chat that started its run; after a late OK a run the Chief had started is started again by botdot, not handed to the Chief.
- Milestone 5: real use (A20); the low findings of [milestone5-test.md](../../product/milestone5-test.md). Those that touch the candidates: a one-time script job whose hand-over meets a full queue loses the AI's look; a ring of waiting bots ends only at the timeout; the recall index calls a failed Chief reply with text a success (`lib/chief.js:303`); a failed reply can show terminal colour codes.
- Unstable tests. `test/one-time-queued.test.js:61` failed once in a full run on 2026-10-06 and passed alone three times; Milestone 5 recorded "the full-queue test depends on the clock in about one run in six". Two others, in `test/awaits.test.js` and `test/one-card.test.js`, were fixed by pull requests 250 and 253. A milestone that reworks the queue changes all three files.
- The task gate ran at 2:03 of its 3 minutes at the end of Milestone 6 (1,025 tests), 2:32 at worst. Four repeating-job tests still wait a real minute.
- Browser tests run in no gate: the repository does not carry Playwright.
- Milestone 3: real use (A14); the audit's "any next message counts as the owner answered" needs an update of [ADR 006](../../adr/006-a-look-is-its-own-read-only-chief-session.md). Not part of this.
- Improvement reports: "Board" proposals 4 and 5 are marked later; neither is part of this.
- Issue 9 (security findings before an open-source release) is open and blocked on the release scan.
- No task is unfinished and nothing is blocked from outside.

## Proposed boundary for the discussion

In, for the owner's choice at stage 2 and 3: the four parts of "Busy and stopped" on the botdot server, the web page and the Android app. The first two are one piece of work, because a queue without a rule for Stop is unfinished. The last two can each be cut without breaking the first.

1. **One rule for busy:** the owner's message waits its turn and shows as waiting, for a bot and for the Chief.
2. **Stop:** it stops what it started, who stopped is kept, and it is decided what happens to what waits.
3. **A late result** as a short Chief turn, and a shorter wait.
4. **Failure hygiene:** said once and not at night, a standing line for a signed-out Claude, a time limit, a reason for a job that did not run.

Out, whatever is chosen: a message that steers a turn already running (a Chief turn is one process with one prompt; it would need an ADR and a process that stays open); a bot's conversation context; staged job and tile changes; a shared voice and one wording layer; new settings (AGENTS.md rule 5); anything that shows costs; the Mac app ([ADR 008](../../adr/008-the-mac-app-is-no-longer-developed.md)).

Three things a plan would get wrong by trusting the audit: the Chief's waiting turns hold botdot's own notices and cannot hold an owner's message as they are; first in, first out with a cap of ten would make the owner wait behind jobs and reviews and refuse them when full; and a run that waits for a connected-app OK holds the bot, and so its queue, for up to ten minutes ([ADR 010](../../adr/010-a-connected-app-action-waits-in-its-run.md)).

## Existing solutions

Date: 2026-10-06. A delta on the Milestone 5 and 6 notes. Every page was read raw with curl today: Markdown twins, HTML with the tags stripped, GitHub's article API, Zapier's help-centre API. No summarising tool was used. "Unverified": no primary page gave the fact. "Not documented": the pages opened do not say.

### 1. A scheduled automation that keeps failing

#### OpenClaw
https://docs.openclaw.ai/automation/cron-jobs/delivery
- A threshold: "covered by default after 2 consecutive failures with a 1-hour cooldown."
- Once per incident: "Repeated failures with the same cause form one incident and do not send repeated alerts, even after the cooldown expires or the Gateway restarts."
- A silent recovery: "A successful run clears the incident and its cooldown without sending a notification".
- Repair first: "the first failure alert of a streak becomes a repair request in the conversation that created the job"; "A transient outage gets no reply".
- It pauses the job: "A time-based recurring job is auto-disabled after 10 consecutive execution failures".
- Overlap: the closest product. Better: one alert per incident, and the agent gets a turn to repair before the owner hears. Quiet hours for failure alerts: not documented.

#### Zapier
https://help.zapier.com/hc/en-us/articles/8496289225229, https://help.zapier.com/hc/en-us/articles/8496216132621
- Every time by default: "Immediately: receive an email notification for each error when it occurs. This is the default."
- A digest: "Hourly summary: at the top of the hour, receive a summary of any errors that occurred in the past hour."
- It switches off: "Zapier will automatically turn off your Zap if it: Errors 95% of the time it runs. Has run more than 20 times in the past 7 days."
- Overlap: botdot's default today. Better: the digest and the switch-off.

#### Healthchecks.io and Cronitor
https://healthchecks.io/docs/configuring_notifications/, https://healthchecks.io/docs/configuring_checks/, https://cronitor.io/docs/alerts, https://cronitor.io/docs/monitors-api, https://cronitor.io/docs/maintenance-windows-api
- Healthchecks.io alerts on a change of state: notifications "when checks in your account change state". Reminders are a choice: "hourly or daily email reminders if any check is down".
- Cronitor: "Recovery alerts are also sent when a monitor returns to a "healthy" state." `failure_tolerance`: "Allow consecutive failures before alerting". `realert_interval`, 8 hours by default: "how long to wait before sending follow up alerts after a monitor fails (and does not recover)".
- Cronitor's maintenance windows "suppress alerts during planned downtime": the nearest thing to quiet hours found.
- Better: once down, once up.

#### GitHub Actions, n8n, Home Assistant, Devin, ChatGPT
https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs, https://docs.n8n.io/build/flow-logic/handle-errors-gracefully, https://www.home-assistant.io/integrations/repairs/, https://docs.devin.ai/product-guides/scheduled-sessions, https://learn.chatgpt.com/docs/automations
- GitHub: every run; the one filter is "Only notify for failed workflows". Scheduled workflows are switched off for inactivity, not for failures.
- n8n: an error workflow "runs if an execution fails". De-duplication: not documented.
- Home Assistant: no push; a standing list of repairs with a count "shown in the sidebar on the “Settings” menu item". A repair for a failing automation: not documented.
- Devin: "**On failure only** — Only get notified when a scheduled session fails (default)"; a schedule's status can be "**Error** — The schedule encountered consecutive failures".
- ChatGPT scheduled tasks: not documented.

### 2. A time limit on an agent's run

#### Claude Code (`claude -p`) and the Agent SDK
https://code.claude.com/docs/en/cli-reference, https://code.claude.com/docs/en/env-vars, https://code.claude.com/docs/en/headless, https://code.claude.com/docs/en/agent-sdk/agent-loop
- No total limit: `--max-turns` has "No limit by default" and "Exits with an error when the limit is reached". A limit by the clock: not documented.
- Watchdogs for silence instead: the stream's "Event-level watchdog" is 300 seconds; a sub-agent with no progress for 10 minutes is aborted and "reports the stall to the parent".
- Tools: Bash "120000, or 2 minutes" by default; MCP idle "300000 (5 minutes) for network servers and 1800000 (30 minutes) for stdio servers".
- After the last turn: "the wait ends after 10 minutes of continuous idle waiting, so a stuck subagent or workflow can't hold the process open indefinitely."
- Overlap: botdot's engine. It already ends a silent model or tool; a run that keeps making slow progress has no end unless botdot adds one.

#### OpenClaw
https://docs.openclaw.ai/automation/cron-jobs/how-it-works, https://docs.openclaw.ai/concepts/agent-loop
- Scheduled runs: "bounded by the scheduler's own 60-minute watchdog". A chat run: 48 hours, and "Progress does not reset it."
- Silence: "Model idle timeout | Cloud 120s; self-hosted 300s"; "Active work with no recent progress reports as `session.stalled`".
- What the user sees: "A terminal timeout is a failed turn, not a successful completion."
- Better: both kinds of limit, a short total for a scheduled run and a watchdog everywhere.

#### Codex, Cursor, Devin, GitHub Actions, n8n
https://learn.chatgpt.com/docs/config-file/config-reference, https://cursor.com/docs/cloud-agent/api/endpoints, https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax, https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/configuration-examples/configure-workflow-timeouts
- Codex: `stream_idle_timeout_ms`, 300000 by default. A limit for a whole turn: not documented.
- Cursor: a run status `EXPIRED`; its limit is not documented.
- GitHub: `timeout-minutes`, "Default: 360", a total only. n8n: no limit by default.

### 3. Who stopped it, and a run that did not run

#### Claude Code and Claude Desktop
https://code.claude.com/docs/en/agent-view, https://code.claude.com/docs/en/agent-sdk/typescript, https://code.claude.com/docs/en/desktop-scheduled-tasks
- One "Stopped" state, three named causes: "You stopped the session with `Ctrl+X` or `claude stop`, its process was ended from outside Claude Code, or it ended while the background service was off".
- A skipped run is listed with its reason: "Hover a skipped entry to see why: your computer was asleep, the previous run was still in progress, or other scheduled tasks were already running."
- After time away: "exactly one catch-up run for the most recently missed time and discards anything older".
- Better: what botdot lacks, a row with a reason.

#### OpenClaw
https://docs.openclaw.ai/concepts/agent-loop, https://docs.openclaw.ai/automation/cron-jobs/managing-jobs
- The cause travels with the stop: "Chat abort keeps its immediate terminal with `aborted: true` and the caller's stop reason (for example `rpc`, `restart`, or `timeout`)."
- Run history has "`status` (`ok`, `error`, or `skipped`)"; a skip is "a skipped run-history entry with the reason".
- Missed while down: caught up by default; `cron.skipMissedJobs: true` skips them.

#### GitHub Actions, Codex, Cursor, Devin, schedulers
https://docs.github.com/en/rest/checks/runs, https://learn.chatgpt.com/docs/app-server, https://docs.devin.ai/v3-openapi.yaml, https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/, https://apscheduler.readthedocs.io/en/3.x/userguide.html
- GitHub's conclusions separate `cancelled`, `skipped`, `timed_out` and `failure`. That the page shows who cancelled: not documented.
- Codex: `turn.status` is `completed`, `interrupted` or `failed`; who interrupted is not documented. Devin: `suspended` carries a `status_detail` such as `inactivity`, `user_request` or `usage_limit_exceeded`.
- Kubernetes `Forbid`: "the CronJob skips the new Job run". APScheduler: a run due while the last has not finished "is considered a misfire"; with coalescing "it will only trigger it once."
- The pattern after time away is one run, not one per missed time.

### 4. A delegated agent's result that comes late

#### Claude Code
https://code.claude.com/docs/en/sub-agents, https://code.claude.com/docs/en/headless
- The parent takes a turn: "A background subagent's results reach Claude as a completion notification in a later turn."
- It is marked as not from a person: "The notice states that no human input has occurred, so the model doesn't treat the notification as a user instruction or approval."
- On a failure "the message Claude receives when it ends names the API error and includes the subagent's last output".

#### OpenClaw
https://docs.openclaw.ai/tools/subagents/announce
- A parent turn: "Top-level requester sessions use a follow-up `agent` call with external delivery", with an "Instruction to review the result, continue unfinished work, and report the outcome".
- The status is "Derived from runtime outcome (`ok`, `error`, `timeout`, or `unknown`) — **not** inferred from model text". The child's answer goes in whole.
- Overlap: the same shape as the Chief and its bots.

#### Cowork Dispatch, Codex, Cursor, Devin
https://claude.com/docs/cowork/guide/dispatch, https://learn.chatgpt.com/docs/agent-configuration/subagents, https://cursor.com/docs/subagents
- Dispatch "surfaces the results in the sidebar when they finish"; a summarising turn is not documented. Codex waits for all results. Cursor's parent reads files; a wake-up is not documented. Devin sets itself reminders to check.

### Reused
- A message sent to an agent that is still working (Claude Code, Codex, Cursor, OpenClaw, Devin): Milestone 6 note, section 1, 2026-10-05. Its findings stand: four products queue, the queued message is shown above the box and can be taken back, Send stays while a run works, the message is stored before it is acknowledged, and OpenClaw's Stop covers the whole tree and discards queued follow-ups.
- Where an approval appears: Milestone 6 note, section 2, 2026-10-05. OpenClaw: a typed answer to an open question goes to that question before the queue.
- Scheduled agents, delivered versus silent: Milestone 5 note, 2026-10-05.
- help.openai.com returns 403: Milestone 2, 3, 5 and 6 notes. Not tried again.

### Refreshed or added
All 2026-10-06; all four sections are new questions. Could not verify: quiet hours for failure alerts in any product; who cancelled a GitHub run; Cursor's `EXPIRED`; a whole-turn limit in Codex; a repair for a failing Home Assistant automation.

## Ideas worth adopting

1. One rule on the server for a busy chat: take the message, store it before answering, start it when free. Never refuse, never fork. Claude Code, Cursor, OpenClaw, Devin (Milestone 6 note).
2. Show the waiting message above the box; taking it back puts the text in the box. Claude Code, Claude desktop, OpenClaw (Milestone 6 note).
3. Keep Send while a run works and give Stop its own place. Claude desktop, Devin (Milestone 6 note).
4. Stop in the Chief's chat stops the runs that turn started, and says so when one could not be stopped. OpenClaw (Milestone 6 note).
5. Keep the stop's cause with the run and word it from that: you, the Chief, a time limit, a restart, a sign-out. OpenClaw, Devin, Claude Code.
6. Say a failure once per streak; stay silent until it recovers or the cause changes. OpenClaw, Healthchecks.io, Cronitor.
7. Two limits: the engine's own watchdog for silence, and a total for a scheduled run. Show a timeout as its own failed state. Claude Code, OpenClaw.
8. A row with a reason for every job that did not run; after time away, one run. Claude Desktop, OpenClaw, Kubernetes, APScheduler.
9. A late result reaches the Chief as a turn marked "not from the owner", with the run's real status; the bot's text stays in the bot's chat. Claude Code, OpenClaw.

Not adopted without an owner decision: pausing a job after N failures (OpenClaw, Zapier) changes what runs unattended; a repair turn for the Chief before the owner hears (OpenClaw) is a new behaviour of the Chief.

## Solutions that make part of botdot unnecessary

None replaces the product. Claude Code's `--input-format stream-json` already queues messages into a running process and would take a message into a Chief turn; it needs a process that stays open per chat and an ADR, and the queue on the server is needed anyway for a bot, whose run is fresh per message. Claude Code's own watchdogs already end a run whose model or tool is silent, so botdot needs no idle watchdog of its own, only a total limit.

## Uncertainties resolved at stage 4

All by reading the code at `ee91cb3` on 2026-10-06; nothing was run. Two architecture decisions are proposed: [ADR 011](../../adr/011-a-bot-does-one-thing-at-a-time-and-the-owners-message-waits.md) and [ADR 012](../../adr/012-a-run-keeps-who-ended-it-and-a-stop-ends-what-its-turn-started.md). None of the findings changes the agreed outcome or scope.

- **Can the owner's message be work that waits?** Yes, as a new kind beside the six the queue has. An item already carries a prompt and files (`lib/bots.js:1402`). What it lacks is a kind that keeps the owner as the starter, and room of its own: `enqueue` refuses at ten of anything (`:1441`).
- **What does the app get back when nothing started?** Everything that reads the answer wants a run's id: the message key keeps `{ runId }` (`server.js:1714`), `wait_for_run` asks for it (`lib/mcp-server.js:631`), a tile returns it (`server.js:76`). A run's id is made inside `startRun` from the clock and six random characters (`lib/bots.js:928`); nothing reads the time back out of it for a rule. So the id can be made when the message is taken and handed to `startRun` when its turn comes. The answer then has the fields of a run with a status the apps have not seen, `waiting`.
- **Does `wait_for_run` survive a run that has not started?** Not as it is: the wait route answers at once for a run that is not going (`server.js:1743-1755`, "not running (any more)"), and the tool's loop would return a run without a record. The route has to know the waiting ids and hold for them too.
- **Can a Chief turn be told that the owner wrote?** Yes, without touching the Claude process. `wait_for_run` is a loop of calls of at most 25 seconds to that same route, marked `seen=chief` (`lib/mcp-server.js:629-637`). The server knows which chat's turn waits on a run (`chatOfRun`, `lib/chief.js:280-285`, running turns included). When an owner's message waits in that chat, the route answers the open call at once with a note for the Chief, and the tool returns it. The turn ends by itself; the run is untouched.
- **Where does the Chief's waiting message live?** Not in the chat file while the reply is going: the turn saves the chat from its own copy and would write over it (`lib/chief.js:550`, `592`, `645`). It waits in `chief-waiting-turns.json` beside the turns botdot starts, as an item that keeps the owner's text, files and key, and the chat's answer lists it. When its turn comes it goes through `send()` as if sent then, so the plan and the unseen lines are handled at that moment (`:446-475`), which is when they are true.
- **Does a waiting message count as "the owner asked again"?** The rules of [ADR 009](../../adr/009-the-botdot-server-carries-on-after-an-ok.md) count runs the owner started, by their start (`lib/asks.js:526`). A message that waits has no run yet. Proposed for the owning task: it counts from when it was sent, since that is when the owner asked.
- **A waiting message whose file is gone.** `uploads.check` throws for a missing file (`lib/uploads.js:236`), and `drainQueue` drops work that throws with a console line (`lib/bots.js:1453`). The owner's message must not vanish: it starts without that file, as work that carries on does (`:780`).
- **Can Stop find the runs of a reply?** Yes: the reply's `actions` of kind `run` are there while the turn is going (`lib/chief.js:407`, `417`). A run of `run_job` is among them; a run that waits to start is found by its id in the queue.
- **Which rules read "stopped"?** Three (`lib/bots.js:1743`, `lib/asks.js:478`, `lib/connector-approvals.js:186`), all meaning the owner. With a sign-out and the time limit recorded as failures (ADR 012) those three keep their meaning without a change; only the Chief's `stop_run` needs a decision, left to the owning task.
- **Can a failure be quiet?** Not today: a quiet run is a scheduled run that ended well (`lib/problems.js:25`), a failed run always counts as new (`lib/read.js:31`), and the report rules return before quiet hours for anything but a success (`lib/reporting.js:21`). All three are one condition each. The job's state already keeps its last status (`lib/bots.js:1038`); a count of failures in a row and the time of the first belong there. Held reports are found again and delivered on the first minute outside quiet hours (`:1261-1273`, `:2097`): a held failure rides the same path.
- **How does the phone learn to stay silent?** It notifies exactly when the feed says `new` (`feed/Notifier.kt:633-634`) and prints the job's name and the server's `problem`. So the server decides, and an app from Milestone 6 follows without an update. The morning's line is that same `problem` with the count before it.
- **Can botdot know that it was off over a job's time?** Not today: the last minute the scheduler looked at is kept in memory (`lastTick`, `lib/bots.js:1893`). It has to be written down each minute; at start the gap between it and now is checked against each job's times, once.
- **Does the scheduler know that Claude is signed out?** No (`lib/bots.js:1892-1923`). The check exists and is cached for 20 seconds (`lib/setup.js:48-64`); the feed already carries a `claude` event and `hello` has the state (`server.js:1879-1897`), which neither app draws. No new route is needed.
- **The apps.** Read by a separate reader on 2026-10-06; its findings are in the plans of BUSY-005 and BUSY-006.
- **The gates.** `MILESTONE_STAGES` is `tools-real`; `RESILIENCE_STAGES` is the Android build, tests and lint. The task gate took 2:03 of 3:00 at the end of Milestone 6. Every new test of a limit, a streak or quiet hours sets its clock short. `test/one-time-queued.test.js:61` fails about one run in six by the clock: BUSY-001 changes that file and makes the test independent of the minute.
- **Not resolved, and where it is decided:** that the Chief ends its turn in one line when told the owner wrote, and that its turn for a late result is short and right, are model behaviour: the owner's checklist and B23. Whether 60 minutes cuts real work is seen only in use.
