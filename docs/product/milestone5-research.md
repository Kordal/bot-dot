# Milestone 5 research: the quick wins of the interaction audit

Planning status: stage 6 closed on 2026-10-05; next: delivery, starting with QW-001.

Date: 2026-10-05. Revision inspected: `main` at `ee27a02` (the features "Vault item types" through pull request 223 and "Board" through pull request 227 are merged). `node scripts/agent-local.mjs phase` prints `between`: every task is done, no task is claimed, and `docs/plans/planned/` and `active/` are empty. No product tests were rerun. This note is research evidence, not an implementation plan.

## Why this milestone

On 2026-10-04 the owner asked for an audit of how the bots interact with the user. It is recorded as [How the bots interact with the user: an audit](improvements/2026-10-05-bot-interaction-audit.md): 168 findings, each re-checked against the code. On 2026-10-05 the owner asked to plan "all" of its section 8, the quick wins: ten numbered changes and five more under "Also small".

## What the product delivers today

The audit read `main` at `debefff`. Each quick win was looked up again at `ee27a02` on 2026-10-05; all ten still hold, at the lines below.

| # | Quick win | Verified at `ee27a02` |
| --- | --- | --- |
| 1 | A failed send keeps the message | The web page empties the box and hands over the files before the request (`public/app.js:1996-1999`); Android does the same (`ui/Components.kt:588`). Failure is a toast or a snackbar only |
| 2 | No yes in chat where a card follows | The Chief is told to offer a missing permission "once the user says yes" and to "get a clear yes first" before anything with lasting effects (`lib/chief.js:110`, `113`); the server then holds the same change for a card (`lib/bots.js:283-294`, `303`) |
| 3 | A hand-off always comes back | The asking bot is started again only when an answer came (`lib/bots.js:1378-1379`); a teammate's run that ends only marks the wait done (`lib/awaits.js:44`, `lib/bots.js:928`). `test/awaits.test.js:78` pins "nobody answered: no follow-up" |
| 4 | A requested report arrives | Every job defaults to `report-only` (`lib/jobs.js:51`, `lib/bots.js:842`); a scheduled reply without `notify_owner` is marked quiet (`lib/reporting.js:21-25`). `attach_file` answers "It shows under your reply" in every run (`lib/self-mcp.js:403`) |
| 5 | Fewer needless questions | 22 `confirm(` calls in `public/app.js`; the seven the audit calls needless are at `895`, `1325`, `2538`, `2887`, `2952`, `3284`, `3365`. The password warning is at `1995`, its pattern at `3967` |
| 6 | The phone approves only what it shows | `askBrief` sends `what` for a permission only, and `yesOn: 'card'` for a tool from a link only (`server.js:88-95`). Android prints "Asks to " plus `what` with Allow (`feed/Notifier.kt:523`) and "Waiting for your OK: <job name>" with Approve (`:255`) |
| 7 | Chips say what waits and name the bot | `botSummary` drops `pendingChange` (`lib/mcp-server.js:34`); the chips read "Created", "Updated" and "Deleted <id>" (`lib/chief.js:375-377`) |
| 8 | A failed Chief reply looks failed | An error result's text becomes the reply (`lib/chief.js:567-569`); the feed says `success` whenever text exists (`:603`); an empty reply is "Done." (`public/app.js:2075`) |
| 9 | Notes reach a bot with learning off | `learningNote` (`lib/bots.js:1076`) returns the shared notes only when learning is off; both apps say "it reads these notes" (`public/app.js:3232`, `ui/MemorySection.kt:88`) |
| 10 | One "Can't reach botdot" | `api()` throws the browser's own fetch error (`public/app.js:26-35`); the background refresh toasts it (`:384`) |

What changed between the two revisions and matters here:

- **Board.** The Dashboard is the Board in every text the owner reads; the API paths keep "dashboard". The audit's tile findings are not quick wins.
- **BOARD-003.** A scheduled script that hands its output to the AI now shows only the AI's report. It closes the audit's finding "the recommended script-then-AI job tells the owner twice", which was not a quick win. It touched `lib/reporting.js` and `public/quiet-runs.js`, the files quick win 4 changes.

## Evidence boundaries

- Every code fact above was read, not exercised: no server was started and no message was sent.
- What a bot or the Chief says is model behaviour. That the Chief asks for a yes in chat, or that a bot ends its run without `notify_owner`, follows from the prompts; how often is not measured.
- The audit did not cover the first run and pairing, updates and backups, and several Android settings screens.
- The quick wins were sized by reading. "Small" was the auditors' estimate, not a plan.
- Other products' behaviour in "Existing solutions" comes from their documentation, not from use.

## Evidence and candidate improvements

| Evidence | Candidate improvement |
| --- | --- |
| The box is emptied before the send on both apps (verified). | The text and files come back when a send fails, or stay until the server accepted them. |
| The web page toasts the browser's raw error from a background refresh (verified). | One standing line "Can't reach botdot" while the server is away; no toast from the background. |
| The Chief's prompt asks for a yes that a card repeats (verified in the prompt; behaviour inferred). | The card is the one confirmation; the Chief says that it waits. |
| The chips say "Created" and "Updated" while a change waits, and "Deleted" with an id (verified). Recorded as open by MSG-008. | The tools' answers carry what waits; the chips say it and name the bot. |
| A bot-change, a connector action and a script job can be approved from a notification that does not show them (verified). `yesOn` is honoured by the apps for any kind (Milestone 4 follow-up). | The server gives every ask a line of text and `yesOn: 'card'` where the notification cannot show what is approved. |
| A failed Chief turn with any text is drawn and announced as a reply (verified). | A status on the Chief's message, set on the server and drawn by both apps; no made-up "Done." |
| A hand-off whose teammate does not message back ends in silence, against `README.md:78` (verified; pinned by a test). | The follow-up starts when the wait is over, also with no answers, with the teammate's reply or its problem. |
| A scheduled reply without `notify_owner` reaches nobody; one-time jobs too (verified; the default is documented). | A report the owner asked for gets notify "always"; a one-time job always delivers; `attach_file` says the truth in a report-only run. |
| A bot with learning off gets no private notes while the apps say it reads them (verified). | The pinned notes stay in the prompt when learning is off. |
| Seven questions confirm what can be undone; the password warning matches ordinary sentences (verified). | The seven go; the pattern is narrowed. |
| "Also small", verified at `ee27a02`: three style blocks that disagree (`lib/chief.js:97-98`, `lib/bots.js:48`, `lib/look.js:71`); cost reaches the Chief (`costUsd` in `lib/mcp-server.js:45`, "free" in `:123`, `lib/jobs.js:21`, `lib/chief.js:116`); the server words the Chief's activity for two tools only, the rest is a table per app (`lib/chief.js:508-512`, `public/app.js:1521`, `2072`); the bot's computer is one "that only you use" (`lib/bots.js:67`); `bypassPermissions` is chosen in a bot's settings with no question (`public/app.js:264`). | Candidates for the same milestone; a scope question for stage 3. |

## Carried forward

- Milestone 3: real use (A14) on the owner's own botdot server and the follow-up list of [milestone3-test.md](milestone3-test.md) are open and for the owner to decide.
- Milestone 4: the low findings under Follow-up of [milestone4-test.md](milestone4-test.md). Two belong to this subject: Android builds the summary line of an ask itself, and `yesOn` is sent for a link tool only.
- Improvement reports: "Board" proposal 4 (the word at the start of the strip) and proposal 5 (rename the API paths) are marked later; neither is part of this.
- The audit's sections 9 and 10 (structural changes: asks that resume, one rule for a busy chat, a connector action that waits, a bot's conversation context) are not this milestone. Quick wins 3 and 4 touch the same code as two of them and must not close off those designs.
- Issue 9 (security findings before an open-source release) is open and blocked on the release scan.
- Browser tests are still in no gate.
- No task is unfinished and nothing is blocked from outside.

## Proposed boundary for the discussion

In: the ten quick wins on the botdot server, the web page and the Android app. Whether the five under "Also small" join is the owner's decision at stage 3.

Out: every structural change of the audit's section 9; the Mac app ([ADR 008](../adr/008-the-mac-app-is-no-longer-developed.md)); new controls (AGENTS.md rule 5); anything that shows costs.

## Existing solutions

Date: 2026-10-05. A delta on the Milestone 2, 3 and 4 notes. Every URL was opened today; those not read as raw text went through a summarising fetch tool. "Unverified": no primary page gave the fact.

### 1. A message that fails to send

#### Signal (Android source)
https://raw.githubusercontent.com/signalapp/Signal-Android/main/app/src/main/res/values/strings.xml, https://raw.githubusercontent.com/signalapp/Signal-Android/main/app/src/main/java/org/thoughtcrime/securesms/conversation/ConversationItem.java
- The failed message stays in the thread. Its footer reads "Not sent, tap for details" or "Send failed".
- The failed bubble takes over the tap (`onMessageWithErrorClicked`); the menu offers "Resend". An attachment has its own resend control.
- Better than botdot: failure is a state of the message, not a toast.

#### Telegram (TDLib)
https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1message_sending_state_failed.html, https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1resend_messages.html
- A failed message carries `error`, `can_retry` and `retry_after`; `resendMessages` sends it again. The server says whether a retry can work, and when.

#### Claude desktop app
https://claude.com/docs/cowork/changelog
- "a message that cannot be sent now offers Retry"; the retry card and prompt text "survive an app relaunch".
- A bad attachment is marked with its problem. Remote Control still delivers the message and adds "[1 of 3 attachments did not arrive]" (https://code.claude.com/docs/en/remote-control).

#### WhatsApp, Slack, ChatGPT
- Unverified, all three. WhatsApp's page returned no body (https://faq.whatsapp.com/5155925751185676). Slack's release notes only mention deleting a failed message (https://slack.com/release-notes/android). help.openai.com returned 403.

### 2. Pause for approval, then resume

#### Claude Code
https://code.claude.com/docs/en/remote-control, https://code.claude.com/docs/en/claude-code-on-the-web, https://code.claude.com/docs/en/hooks
- The prompt blocks the tool call; the same turn continues on Yes. Prompts stay "open until you answer them".
- Cloud: a late answer still works, "and the session continues from your answer". After the machine expires, only history returns.
- For `claude -p`: a `PreToolUse` hook returns `defer`, the process exits with `tool_deferred`, the caller asks and resumes. "There is no timeout or retry limit." Only when the turn makes one tool call.
- Overlap: botdot's own engine; `defer` is the pause its asks lack.

#### OpenClaw exec approvals
https://docs.openclaw.ai/tools/exec-approvals, https://docs.openclaw.ai/tools/exec-approvals-advanced
- The run "waits for the decision within the originating tool call". "A late approval cannot restart it."
- Approvals expire after 30 minutes; the agent is told the command did not run. Better: a late answer has a stated result.

#### Devin, Codex, Cursor
- Devin waits 30 seconds on a plan unless "Wait for my approval" is chosen, and "resumes promptly after you approve or deny". https://docs.devin.ai/release-notes/2025, https://docs.devin.ai/release-notes/2026
- Codex cloud runs to the end; review comes after (https://learn.chatgpt.com/docs/cloud).
- Cursor cloud agents: approvals not documented (https://cursor.com/docs/cloud-agent). ChatGPT agent: 403, unverified.

### 3. Approving from a phone notification

#### Android
https://developer.android.com/develop/ui/compose/notifications, https://developer.android.com/reference/android/app/Notification.Action.Builder
- Buttons show on the lock screen. `setAuthenticationRequired(true)` (API 31) asks for unlock first; botdot already sets it (`Notifier.kt:334`). No rule on destructive actions found.

#### GitHub Mobile and Microsoft Authenticator
https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa/accessing-github-using-two-factor-authentication, https://learn.microsoft.com/en-us/entra/identity/authentication/how-to-mfa-number-match
- GitHub's prompt "may require you to enter a two-digit number" from the browser. Pull request approval from a notification: not documented.
- Microsoft: the user types the number; plain Approve/Deny is legacy; watches are excluded. Banks: no page opened, unverified.

#### Claude, Codex Remote, Cursor
- Claude pushes when it needs a decision or finishes (https://code.claude.com/docs/en/mobile). Cursor pushes when a turn finishes (https://cursor.com/docs/cloud-agent/mobile). Codex Remote shows approval requests in the app (https://learn.chatgpt.com/docs/remote). Answering from the notification itself: not documented in any.

### 4. Scheduled agents: delivered versus silent

#### OpenClaw
https://docs.openclaw.ai/gateway/heartbeat, https://docs.openclaw.ai/automation/cron-jobs/delivery
- Heartbeat's silent answer is now `NO_REPLY`; `HEARTBEAT_OK` is legacy.
- Cron: delivery is set per job (`announce`, `webhook`, `none`). An empty result is skipped and recorded as `empty`; errors are still sent. Each run records delivered, not delivered or unknown.
- Failure alerts start after 2 failures in a row.

#### ChatGPT scheduled tasks and "dot"
https://learn.chatgpt.com/docs/automations, https://learn.chatgpt.com/docs/dots/tasks-and-memory
- Runs "with findings appear" in a Scheduled inbox with an unread mark.
- The rule lives in the prompt: "how to decide whether there is anything important to report", "Which changes deserve a notification".

#### Gemini scheduled actions
https://support.google.com/gemini/answer/16316416
- Every run marks its chat unread and notifies. No silent option documented.

### Reused
- Silent answer, active hours, skip when nothing to look at (OpenClaw): Milestone 2 note, 2026-10-02; Milestone 3 note, 2026-10-03.
- "Needs attention" as its own sidebar state (Grok Bot): Milestone 2 note, 2026-10-02.
- The agent proposes, the owner approves a card (Devin): Milestone 4 note, 2026-10-03.
- help.openai.com returns 403 (agent, Tasks, Pulse): Milestone 2 note, 2026-10-02; Milestone 3 note, 2026-10-03. Still 403.

### Refreshed or added
All 2026-10-05.
- OpenClaw's silent token is `NO_REPLY`; earlier notes name `HEARTBEAT_OK`.
- OpenClaw cron delivery and failure alerts: not covered before.
- ChatGPT scheduled tasks, from learn.chatgpt.com: earlier notes had only 403s.
- ChatGPT "dot", a named assistant with background agents: new, and close in name.
- Sections 1 to 3: new questions.

## Ideas worth adopting
1. (Q1) Keep the failed message as a bubble marked "Not sent" with Retry, across restarts. Signal, Claude.
2. (Q1) Mark the failing attachment itself and still send the rest. Claude.
3. (Q2) Hold the ask inside the paused tool call, so Yes returns to the same turn; try `defer`. Claude Code, OpenClaw.
4. (Q2) Give a late answer a stated result: still valid, or expired with the bot told. OpenClaw.
5. (Q3) Keep unlock-protected buttons for one-step asks; open the card when the owner must read a command. Android, Microsoft.
6. (Q4) Make delivery part of the job: "always report" or "only if". Hide only an empty "only if" result; alert on repeated failure. OpenClaw, ChatGPT.

## Solutions that make part of botdot unnecessary
None replaces the product. One part need not be built: Claude Code's `defer` already pauses and resumes a `claude -p` run at a tool call; its one-tool-call limit needs a trial. ChatGPT's "dot" is similar but hosted.

## Uncertainties resolved at stage 4

All by reading the code at `ee27a02`; nothing was run. No architecture decision is needed, so no ADR is proposed.

- **Can botdot hand a silent teammate's reply to the asker?** Yes. `finish()` in `lib/bots.js` calls `awaits.runEnded(bot.id, chainId)` knowing the run it ends; the wait can keep that run's id, and `followUpPrompt` already reads a run with `readMeta` and already writes "No answer from …". A wait that ran out of time has no ended run: the asker is told the teammate has not finished.
- **Can the server tell a one-time job's run?** Yes. The job has `at` when the scheduler starts it (`lib/bots.js`, the scheduler's loop), where the run's `notify` is already copied onto the run.
- **Do the pinned notes exist for a bot with learning off?** Yes. `learn.memoryForPrompt(bot.id)` builds them; `learningNote` returns before calling it.
- **Do new fields break an older app?** No. Both apps ignore fields they do not know. Android from Milestone 4 on honours `yesOn` on an ask of any kind, so it loses the yes on a changed bot and a connected-app action at once. It builds a job's and a tile's notification itself, so those keep their yes until the app is updated. Recorded as an evidence limit of A19.
- **Does a failed Chief reply need a new field?** No. The message already carries `text` and `error` together when a turn fails after writing; the apps do not draw `error` then. The server must also set `error` for a stopped turn with text and for an empty reply, and announce failed as failed on the feed.
- **Where do the Android checks run?** `make android-test` is a stage of the resilience gate, once, at the acceptance task. The Android task writes unit tests there; its task gate is `make lint` and `make test`.
- **Does a task need the server to change first?** Only one: the second server task changes the same files as the first (`lib/chief.js`, `lib/mcp-server.js`). The web and Android tasks build against the fields written in their plans.
