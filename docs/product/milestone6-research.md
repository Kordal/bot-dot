# Milestone 6 research: what the interaction audit left open

Planning status: stage 6 closed on 2026-10-05; next: delivery, starting with OK-001.

Date: 2026-10-05. Revision inspected: `main` at `6547da9` (Milestone 5 is merged through pull request 238). `node scripts/agent-local.mjs phase` prints `between`: every task is done, and `docs/plans/planned/` and `active/` are empty. No product tests were rerun and no product was started. This note is research evidence, not an implementation plan.

## Why this milestone

On 2026-10-05 the owner asked to plan from [the interaction audit](improvements/2026-10-05-bot-interaction-audit.md) again. [Milestone 5](milestone5.md) delivered its section 8, the quick wins, and excluded every structural change of its section 9. Those are the candidates here.

## What the product delivers today

After Milestone 5 a failed send keeps the message, the phone approves only what it shows, a failed Chief reply looks failed, a hand-off and a requested report come back, and a message is taken once (`message-key`). Of the audit's "Top 5", numbers 2 and 5 are done and number 3 is done except for where the card is shown.

Each remaining finding was looked up again at `6547da9` on 2026-10-05 by reading the code. All hold unless the table says otherwise.

| Area | Verified at `6547da9` |
| --- | --- |
| An OK restarts nothing | A yes on a permission, a bot change, a skill or a job only changes the setting (`server.js:1037-1062`, `1429-1434`); none calls `chief.tell` or `startRun`. The ask keeps no run and no chat: a permission ask is `{ kind, botId, permission, reason }` (`server.js:102`, `1136`), and the run's id is in scope there and unused |
| What does carry on | A tool install keeps `chatId` and `askedBy` and tells the Chief when it is done (`lib/tools.js:226-230`, `335-371`); the Chief then chooses to start the bot again. A login and a payment hold the bot's tool call open in slices of a long poll, 14 and 10 minutes (`lib/vault-mcp.js:75-81`, `lib/computer-mcp.js:217-225`). A bot's plan sends "Approved. Go ahead." |
| "Allow once" on a connected app | `connector_run` throws at once (`lib/connector-approvals.js:24-27`); after the run "That run has ended" (`:37`) and the card stays, because the approval throws before the ask is taken (`server.js:1033-1034`). Nothing withdraws the ask when its run ends. The card's body is policy text and raw JSON (`lib/asks.js:126`). Changed since the audit: the same arguments in the same run reuse one card (`lib/asks.js:41`) |
| Two cards for one grant | A refused tool adds a permission card without looking for a waiting bot change (`server.js:102`, `lib/bots.js:312`). Permission approved first: the bot change answers 409 and stays (`server.js:1040`) |
| Where the card is | The Chief's bot change shows in the bot's chat and in Needs you, not in the Chief's chat (`public/app.js:4636-4648`, `Models.kt:294-298`). Its body is field names with "Now" and "Proposed", no difference shown (`lib/asks.js:121-125`). Milestone 5 added the one-line `text`, `yesOn` and the chip's `waits` |
| A no | Kept for 7 days for a permission and a tool only (`lib/asks.js:20`, `55`). No route takes an ask back |
| A busy Chief | Refuses with a 400 "The Chief is still replying" (`lib/chief.js:424`); both apps put the message back in the box. `wait_for_run` waits 240 s, at most 540 s (`lib/mcp-server.js:627-630`) |
| A busy bot | The server starts a second run beside the first (`server.js:1499`, no check in `startRun`); the second cannot see the first (`lib/bots.js:575`). The web page keeps Send; Android shows Stop. The Chief's `run_bot` and a Board tile fork the same way |
| The queue | `startOrQueue` holds up to 10 items per bot in `data/queue.json` (`lib/bots.js:1277`, `1383`): a teammate's message, replies, a job, a script's follow-up, a review. Never the owner's message. No GET and no feed event lists it. The Chief's `waitingTurns` is in memory only (`lib/chief.js:666`) |
| Stop | Stopping a Chief turn kills the Chief's process only (`lib/chief.js:979-985`); the bot it started runs on. Who stopped a run is not recorded: "You stopped this run" also for the Chief and a sign-out (`lib/problems.js:7`) |
| A late result | Written into the Chief's chat as "Message from <bot>" with no Chief turn (`lib/bots.js:1541-1544`, `lib/chief.js:765-784`) |
| A bot's memory of its chat | A fresh `claude -p` per message. History is 3 runs of the last 3 days, replies cut at 1,500 characters from the start, every prompt under "Owner:" (`lib/bots.js:571-583`). A tapped answer sends only its word (`public/app.js:222`, `BotChatScreen.kt:171`). `read_run` exists; the history gives no run ids. No ADR records "no session resume" |
| A bot's reply that is only questions | Stored empty; the web page shows "Done. (No written reply.)", Android "Done." (`lib/choices.js:46`, `app.js:2474`, `BotChatScreen.kt:216`). Fixed for the Chief in Milestone 5 |
| A changed job or tile | The change stops it until approved (`lib/jobs.js:78-79`), the card says "added" (`app.js:4548`, `lib/asks.js:171`), Decline deletes it (`server.js:1431`, `lib/dashboard.js:356`). A change of time alone counts (`lib/jobs.js:41`) |
| Voice and words | Three style blocks that differ (`lib/chief.js:100`, `lib/bots.js:50`, `lib/look.js:71`). The server words the Chief's activity for two tools; the web page falls back to "Working on it", Android to the tool's name (`app.js:1607`, `ChiefScreen.kt:359`). Six wordings for Needs you. The web page's `md()` draws no quote, rule or nested list (`app.js:345-355`) |
| Failures | A failing job notifies on every run, in quiet hours too (`lib/reporting.js:21`). Thrown errors reach the apps raw as 400 (`server.js:1823`). An AI run has no time limit. A skipped script job is said only on the console |
| The web page's history | 200 newest runs of the team, 40 drawn, no scroll back (`app.js:419`, `public/unread.js:15`). Android pages with `before` (`Api.kt:107-108`) |
| The Chief as a debugger | A run's summary has no job name and no problem sentence; no tool lists what waits in Needs you (`lib/mcp-server.js:46-49`) |

## Evidence boundaries

- Every code fact above was read by an agent on 2026-10-05 and not exercised: no server was started and no message was sent.
- "The run ends" after a refused connected-app action, and "the Chief starts the bot again" after a tool install, are model behaviour, inferred from the prompts.
- Sizes ("Medium", "Large") are the auditors' estimates.
- The audit did not cover the first run and pairing, updates and backups, and several Android settings screens.
- Other products' behaviour comes from their documentation, not from use.
- Milestone 5's real use (A20) on the owner's own server is still open, so nothing here rests on how the quick wins behave in daily use.

## Evidence and candidate improvements

| Evidence | Candidate improvement |
| --- | --- |
| An OK changes a setting and nothing else; the ask keeps no run or chat (verified). Tool install, login and payment show two working patterns (verified). | Every ask records what it interrupted; on yes botdot continues it: the bot's request starts again, or the Chief is told in the chat that asked. |
| `connector_run` cannot wait, so "Allow once" fails after the run (verified). The one-run binding is a recorded security decision (`docs/security-issue-90.md:25-26`). | `connector_run` waits for the answer as `request_login` does; the ask goes when its run ends; the card is worded from the action's fields. |
| The Chief's bot change is a card on another page, and a refused tool adds a second card for the same grant (verified). | The card under the Chief's reply and in Needs you, one answer for both; one card per grant; the difference shown, not two full texts. |
| A busy Chief refuses, a busy bot forks, a queue exists for everything except the owner (verified). Four products queue (documentation). | One rule on the server: the owner's message is taken and waits its turn, shown as waiting; Stop in the Chief's chat stops what that turn started; a late result is a short Chief turn. |
| A bot gets three clipped runs with the wrong sender, and "Yes" without its question (verified). | The answer carries its question; the history is what the owner saw, with the real sender, the last reply whole, and run ids. |
| A changed job or tile stops until approved and Decline deletes it (verified). | The approved version keeps running; the card says "changed" and what; Decline drops the change only. |
| Words are decided per app and per prompt (verified). Not chosen for Milestone 5 by the owner on 2026-10-05. | One voice block for the three prompts; activity, end states and the name of Needs you from one table on the server; one Markdown fixture for both apps. |
| A failing job rings every run; who stopped a run is unknown; raw errors as 400 (verified). | Failures held in quiet hours and said once; the stopper recorded; one problem sentence for a thrown error. |
| The web page cannot scroll back in a bot's chat (verified). | The web page loads a bot's own runs in pages, as Android does. |

## Carried forward

- Milestone 5: real use (A20) on the owner's server; the low findings under Follow-up of [milestone5-test.md](milestone5-test.md). Those that touch the candidates: a plan's Approve and a reply from a notification send no message key; the chip and the notification name the same grant in two vocabularies; `run_job` still hands the Chief a `costUsd` key; a ring of waiting bots ends only at the timeout.
- Milestone 4: the low findings of [milestone4-test.md](milestone4-test.md). One touches the candidates: an install's result that waits behind another Chief reply is lost on a restart (`waitingTurns` is in memory).
- Milestone 3: real use (A14) and the follow-up list of [milestone3-test.md](milestone3-test.md). The audit's "any next message counts as the owner answered" needs an update of [ADR 006](../adr/006-a-look-is-its-own-read-only-chief-session.md).
- Improvement reports: "Board" proposals 4 and 5 are marked later; neither is part of this.
- Issue 9 (security findings before an open-source release) is open and blocked on the release scan.
- Browser tests run in no gate; the task gate runs at about 2 of its 3 minutes.
- No task is unfinished and nothing is blocked from outside.

## Proposed boundary for the discussion

One of four outcomes, for the owner at stage 2:

1. **An OK continues the work.** Asks that resume, a connected-app action that waits, one card per grant shown where the owner asked. Holds both findings the audit calls critical that are still open. Medium.
2. **One rule for busy.** The owner's message queues, the Chief's chat stays usable, Stop stops what it started. Large; changes the message box agreed in MSG-013.
3. **A bot remembers its chat.** The answer with its question, a truthful history. Medium; a session resumed per bot chat would need an ADR.
4. **One voice and one set of words.** Not chosen on 2026-10-05.

Out, whatever is chosen: the Mac app ([ADR 008](../adr/008-the-mac-app-is-no-longer-developed.md)); new controls (AGENTS.md rule 5); anything that shows costs; removing an approval gate.

## Existing solutions

Date: 2026-10-05. A delta on the Milestone 2, 3, 4 and 5 notes. Every URL was opened today and read as raw text: the page's Markdown twin, or its HTML with the tags stripped by a local script. No page went through a summarising fetch tool; a web search was used only to find the Zapier, n8n and Make URLs. "Unverified": no primary page gave the fact. "Not documented": the pages opened do not say.

### 1. A message sent to an agent that is still working

#### Claude Code (terminal)
https://code.claude.com/docs/en/interactive-mode, https://code.claude.com/docs/en/sub-agents, https://code.claude.com/docs/en/tools-reference
- Queued, not refused: "Claude Code queues the message instead of interrupting the turn, and lists the queued entries in the conversation until it sends them." Queued messages "show in gray".
- A queued message also steers: if tools are running, it reaches Claude "as soon as those tool calls finish, within the same turn". Otherwise it goes out when the turn ends, in order.
- Edit or cancel: `Up` takes the queue back into the input box; clear the box to drop it. `Ctrl+Enter` sends it now (v2.1.275): running work moves to the background, or the turn is interrupted.
- Stop is `Esc`. "Claude keeps the work done so far." "Claude Code keeps what you queued and sends it right away."
- Stop and sub-agents: `Esc` stops the response or tool call. Background sub-agents need a second key, `Ctrl+X Ctrl+K`: "Stop all running background subagents in this session". A command started by a foreground sub-agent stops when that sub-agent is interrupted; one started by the main conversation "keeps running after a final response".
- Overlap: botdot's own engine. Better: one rule (queue), a visible queue, and Stop that keeps the queue.

#### Claude Code (Remote Control, claude.ai/code, desktop app, `claude -p`)
https://code.claude.com/docs/en/remote-control, https://code.claude.com/docs/en/claude-code-on-the-web, https://code.claude.com/docs/en/desktop, https://claude.com/docs/cowork/changelog, https://code.claude.com/docs/en/headless, https://code.claude.com/docs/en/cli-reference
- claude.ai/code: "the message queues until Claude reads it. To take a queued message back, click the ✕ on it. The text returns to the message box". Once read, "it stays in the conversation".
- Desktop: "click the stop button to interrupt immediately, or type a correction and press **Enter** to send it without stopping the running action."
- Desktop changelog: the composer keeps "the standard Send button while a response is running" and "sending mid-response queues your message instead of showing a separate Queue button" (2026-07-14). Queued rows have "Edit in composer, Send now, and Remove" (2026-07-16) and drag to reorder (2026-07-02). In chat the first waiting message "offers Send now, which stops the current reply and sends it next" (2026-09-10).
- Remote Control: the phone "shows any subagents and workflows the session already has running in the background. Stop one of them from the device". Queue rules for Remote Control alone: not documented.
- `claude -p`: with `--input-format stream-json` messages queue on stdin ("a message still queued when the limit ends a turn stays queued and starts a new turn"). SIGTERM "terminates the process tree of any Bash command that is still running" and leaves the turn unfinished; "To end the turn instead, send SIGINT". A run with a background sub-agent "stays open until that work completes", at most 10 idle minutes.

#### Codex (CLI, desktop app, cloud)
https://learn.chatgpt.com/docs/developer-commands?surface=cli, https://learn.chatgpt.com/docs/reference/settings, https://learn.chatgpt.com/docs/app-server, https://learn.chatgpt.com/docs/agent-configuration/subagents
- Two keys in the CLI: "Press Tab while Codex is working to queue a follow-up prompt" and "Press Enter while Codex is working to inject new instructions into the current turn."
- Desktop setting "Follow-up behavior": "choose whether a message sent while ChatGPT works should steer the current run or wait for the next run."
- Protocol: `turn/steer` appends input to the running turn; `turn/interrupt` ends it with `status: "interrupted"`.
- Sub-agents: "Ask Codex directly to steer a running subagent, stop it". The web sidebar has no stop per sub-agent. Whether interrupt stops sub-agents: not documented.
- Cloud: follow-ups come after the result (https://learn.chatgpt.com/docs/cloud). A message during a cloud run: not documented.

#### Cursor
https://cursor.com/docs/agent/overview, https://cursor.com/docs/cloud-agent/api/endpoints
- Enter queues: "Messages appear in order below the active task"; drag to reorder. `Cmd+Enter` sends at once.
- Steer: "hit **Send now**, or press Enter twice. The message is delivered at the agent's next tool call instead of cutting off work mid-action". Tab queues instead.
- API: "Only one run can be active per agent." A second run "returns `409 agent_busy`". Cancel ends the run; it "cannot be resumed".
- What Stop does to sub-agents: not documented.

#### OpenClaw
https://docs.openclaw.ai/concepts/queue, https://docs.openclaw.ai/web/control-ui/chat, https://docs.openclaw.ai/tools/subagents/operations
- Four modes per session: `steer` (default: inject into the running turn), `followup` (queue each message), `collect` (merge queued messages into one turn), `interrupt` (abort, run the newest). Queue cap 20; overflow is summarised.
- One run per session: "Per-session lanes guarantee that only one agent run touches a given session at a time."
- A queued message "appears above the composer until consumed or canceled". The row has a pencil to edit, a handle to reorder, Steer and remove.
- Input is stored "before the Gateway acknowledges it". After a restart it shows "as interrupted input" and needs "an explicit resend".
- Stop cascades: "Exact-run Stop cancels that parent's associated sub-agents and Swarm collectors, including their descendants." It also discards queued follow-ups "so they cannot restart work after the stop". The parent's stopped state is not proof "that every child stopped".
- Overlap: closest to botdot (self-hosted, chat with agents that start agents). Better: Stop is defined for the whole tree.

#### Devin
https://docs.devin.ai/release-notes/2026
- Queue is a preference: "automatically queue messages while Devin is working"; queued messages "default to sending immediately when Devin becomes available" (2026-07-17). `Cmd/Ctrl+Enter` on a queued message "sends it immediately" (2026-08-26).
- "Messages queued in a session are no longer lost when the session goes idle and resumes" (2026-09-09).
- Stop is next to voice input while Devin works (2026-05-13). Archiving a working session puts "both the session and any child sessions to sleep".

#### ChatGPT agent
- Unverified. https://help.openai.com/en/articles/11752874-chatgpt-agent and https://openai.com/index/introducing-chatgpt-agent/ returned 403, raw and through the fetch tool.

### 2. Where an approval appears

#### Claude (Claude Code, projects, desktop, mobile, Cowork)
https://code.claude.com/docs/en/sub-agents, https://code.claude.com/docs/en/agent-view, https://code.claude.com/docs/en/claude-projects, https://code.claude.com/docs/en/desktop, https://claude.com/docs/cowork/guide/dispatch
- Inline, and the same turn continues. A background sub-agent's prompt comes to the parent chat: "Claude Code surfaces the prompt in your main session and names the subagent that is asking."
- Both, in agent view: sessions that wait are grouped under "Needs input" at the top; the row shows "the exact question it's asking, above the reply input". A question can be answered there. A permission prompt cannot: "replying doesn't answer it".
- Claude projects has botdot's problem (e): "the prompt is inside that thread and the thread waits until you answer it there. Telling Claude in the project conversation to go ahead doesn't reach it." Its remedy is a "Waiting on you" list and a dot on the Overview button.
- Desktop: "a permission card appears and Claude waits for your choice". Phone: a push "when it finishes or needs your approval".
- Cowork Dispatch: a child task's prompt "is forwarded to you. If you don't respond within ten minutes, the request is automatically denied and the task continues without that action."

#### OpenClaw
https://docs.openclaw.ai/tools/exec-approvals, https://docs.openclaw.ai/tools/exec-approvals-advanced, https://docs.openclaw.ai/channels/telegram/rich-messages
- Configurable, per kind: `mode: "session" | "targets" | "both"`. Telegram: `target`: `dm` (default), `channel` or `both`.
- Same chat by default: "that same chat can approve it with `/approve`".
- Same turn: "ordinary agent runs wait for the decision and receive the exec result in the same turn."
- A typed answer goes to the open question first: "A plain-text answer to a pending agent question goes to that question before ordinary queue handling".
- Scheduled runs differ: their approvals go only to the Control UI and the apps; "chat channels never receive automation approvals".

#### Devin
https://docs.devin.ai/release-notes/2026
- Both. Cards sit in the session's worklog; the sidebar "names the approval a session is waiting on" (2026-09-30) and groups sessions as "Working / Ready / Blocked / Inactive" (2026-09-25).
- Same turn: "Devin now resumes promptly after you approve or deny a permission request while it is waiting" (2026-09-23).
- Approve from where the request arrived: Slack (2026-07-24) and Teams cards.

#### Codex
https://learn.chatgpt.com/docs/agent-configuration/subagents, https://learn.chatgpt.com/docs/dots/controls
- Inline, with the source named: "approval requests can surface from inactive agent threads even while you are looking at the main thread. The approval overlay shows the source thread label".
- A "dot": open the task under Activity, "open the request and respond to continue".

#### Cursor
https://cursor.com/docs/agent/security/run-modes
- Local agents: "Cursor will show you an approval prompt"; where it sits is not documented. Cloud agents: "the agent never asks you to approve an action."

#### ChatGPT agent
- Unverified: 403 (see section 1).

### 3. Conversation history for a headless run per message

#### Claude Code headless and Agent SDK sessions
https://code.claude.com/docs/en/headless, https://code.claude.com/docs/en/sessions, https://code.claude.com/docs/en/agent-sdk/sessions, https://code.claude.com/docs/en/agent-sdk/user-input
- The documented way is to resume: `claude -p "..." --resume "$session_id"`; the id comes from `--output-format json`. `--resume` also takes "the absolute path to a session's `.jsonl` transcript file".
- Transcripts are JSONL at `~/.claude/projects/<project>/<session-id>.jsonl`. "The entry format is internal to Claude Code and changes between versions".
- A resumed session restores "the full history, including tool calls and results".
- The docs also name botdot's way: "Don't rely on session resume. Capture the results you need (analysis output, decisions, file diffs) as application state and pass them into a fresh session's prompt."
- An answer carries its question: return "an `answers` object mapping each question's `question` field to the selected option's `label`", and "Pass through the original questions array".
- Overlap: botdot rebuilds three clipped runs by hand; `--resume` per bot chat would give the full history with tool results.

#### OpenClaw sessions and compaction
https://docs.openclaw.ai/concepts/session, https://docs.openclaw.ai/concepts/compaction, https://docs.openclaw.ai/concepts/session-pruning
- A chat keeps one session until reset; a cron job gets a "Fresh session per run".
- Long history: "Older conversation turns are summarized", "Recent messages are kept intact", and "The full conversation history stays on disk."
- In safeguard mode, the default for new configs, the summary must keep "pending asks and exact identifiers". Tool calls stay paired with their results.
- Pruning drops old tool results from the model's view only; "Original tool-result entries are not rewritten."
- A tapped button reaches the agent as text, `callback_data: <value>`. The question is in the resumed session.

#### Telegram Bot API
https://core.telegram.org/bots/api#callbackquery, https://core.telegram.org/bots/api#inlinekeyboardbutton
- A tap sends a `CallbackQuery` with `data` (set by the bot, "1-64 bytes") and `message`: "Message sent by the bot with the callback button that originated the query".
- A typed reply carries `reply_to_message`: "the original message".

#### Slack interactive messages
https://docs.slack.dev/reference/interaction-payloads/block_actions-payload
- The payload has `message`: "The message where this block action took place", plus `actions` with the `block_id`, `action_id` and `value` the app set.
- Both platforms hand the answer back together with the question. botdot's tapped "Yes" does not.

### 4. An edit to an approved, running automation

#### Zapier
https://help.zapier.com/hc/en-us/articles/9693520498445-Create-Zap-drafts-and-versions, https://help.zapier.com/hc/en-us/articles/42070243063053-Publish-and-manage-agent-versions
- Draft and published: "Edit the draft while the Zap continues to run." "Publish the draft to replace the current zap."
- Discarding touches nothing live: "Deleting a draft is permanent and no changes are made to the current published Zap."
- One draft at a time. Each publish is a numbered version; a run shows the version it used.
- Enterprise: "you must request their approval before the Zap can be published." What a refusal does: not documented.
- Zapier Agents work the same: drafts "Make and test changes without affecting your live agent."

#### n8n
https://docs.n8n.io/build/understand-workflows/save-and-publish-workflows, https://docs.n8n.io/build/manage-workflows/workflow-reviews
- "Production executions will use this published version, not your latest edits."
- Review before publish: "On approval, n8n publishes that version automatically." The reviewer sees a diff "between the currently **Published** version and the version **In review**".
- "Request changes" keeps the review open and publishing blocked. Meanwhile executions "always point to the currently published version".
- Closest to what botdot needs: approve an edit, keep the old version running meanwhile.

#### Make
https://help.make.com/restore-and-recover-scenario, https://help.make.com/active-and-inactive-scenarios
- Version history of manual saves, kept 60 days; a restored version must be saved again.
- Draft versus published, and when a saved edit reaches an active scenario: not documented on these pages. https://www.make.com/en/help/scenarios/scenario-settings returned 403.

#### GitHub Actions
https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments, https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- The approval is on a run, not on an edit: "Once a job is approved", "the job will proceed." "If a job is rejected, the workflow will fail."
- Rejecting fails that one run. The page describes no deletion.
- A job "cannot access environment secrets until one of the required reviewers approves it."

#### OpenClaw automations (cron)
https://docs.openclaw.ai/automation/cron-jobs/managing-jobs, https://docs.openclaw.ai/automation/cron-jobs/how-it-works
- An edit applies at once (`openclaw automations edit <jobId>`). No approval of an edit, no draft: not documented.
- Pause is separate from delete: `disable` keeps the job, `remove` deletes it.
- It argues against botdot's (d): "The job is created **enabled**, not disabled-pending-approval". "A job left disabled waiting for a confirmation that never arrives is invisible to every guard".
- The owner confirms a plain sentence, then the job runs once as a test in the same thread.

#### Devin automations
https://docs.devin.ai/release-notes/2026
- An update needs approval and shows a diff: "added, removed and modified triggers and actions, settings as old → new, and prompt edits as a line diff" (2026-09-09).
- Whether the old version runs until then, and what declining does: not documented.

### 5. Claude Code `defer` for `claude -p`

https://code.claude.com/docs/en/hooks, https://code.claude.com/docs/en/agent-sdk/user-input, https://code.claude.com/docs/en/headless, https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md
- Scope: "Claude Code honors this value only in non-interactive mode with the `-p` flag."
- One call per turn: "`"defer"` only works when Claude makes a single tool call in the turn. If Claude makes several tool calls at once, `"defer"` is ignored with a warning and the tool proceeds through the normal permission flow."
- What the caller gets: the process exits with `stop_reason: "tool_deferred"` and `deferred_tool_use` (`id`, `name`, `input`).
- How it resumes: "The calling process runs `claude -p --resume <session-id>` with the same permission host. The same tool call fires `PreToolUse` again." No prompt is needed on that call. The hook then returns `allow` (the answer goes in `updatedInput`) or `deny`.
- Deny: `"deny"` "prevents the tool call"; the reason is "shown to Claude". Precedence is `deny` > `defer` > `ask` > `allow`.
- Waiting: "There is no timeout or retry limit." The session file is kept 30 days by default (`cleanupPeriodDays`). The hook may answer `defer` again.
- The hook must answer fast: "A timed-out `command`, `http`, or `mcp_tool` hook doesn't block the tool call." It cannot hold the run by waiting.
- Lost tool: if its MCP server is not connected on resume, the run exits with `tool_deferred_unavailable`.
- Permission mode is not restored on a `-p` resume: "pass `--permission-mode` or `--dangerously-skip-permissions` again".
- `AskUserQuestion` exists in a `-p` run "only when it has a permission host", such as `--permission-prompt-tool`.
- Version: added in 2.1.89. A fix for "SDK sessions losing a deferred tool call" is in 2.1.283. botdot pins 2.1.284 (`Dockerfile`).
- The other way, with no exit: a permission host. "Without the flag, your run waits for that host to answer each permission request." The SDK callback "can stay pending indefinitely"; `defer` is for when the wait is longer than the process can live.
- Limit for botdot: `defer` needs the run's session to be resumed. A bot's run is fresh per message by design, so the deferred run alone must keep its session id.
- Not documented: a deferred call made inside a sub-agent.

### Reused
- Pause for approval, then resume (Claude Code prompts, `defer`, OpenClaw exec approvals, Devin, Codex, Cursor): Milestone 5 note, 2026-10-05. Section 5 only adds detail.
- Approving from a phone notification (Android, GitHub Mobile, Microsoft Authenticator, Claude, Codex Remote, Cursor): Milestone 5 note, 2026-10-05.
- Scheduled agents, delivered versus silent (OpenClaw, ChatGPT scheduled tasks, Gemini): Milestone 5 note, 2026-10-05.
- A message that fails to send (Signal, Telegram, Claude desktop): Milestone 5 note, 2026-10-05.
- "Needs attention" as its own sidebar state (Grok Bot): Milestone 2 note, 2026-10-02.
- The agent proposes, the owner approves a card (Devin): Milestone 4 note, 2026-10-03.
- help.openai.com returns 403: Milestone 2 note, 2026-10-02; Milestone 3 note, 2026-10-03; Milestone 5 note, 2026-10-05. Still 403.

### Refreshed or added
All 2026-10-05.
- Cursor cloud approvals: the Milestone 5 note says "not documented". The run modes page says a cloud agent "never asks you to approve an action".
- Claude prompts: the Milestone 5 note says they stay "open until you answer them". True for Remote Control. Cowork Dispatch denies after ten minutes.
- `defer`: resume command, deny, hook timeout, lost tool, permission mode, version. The one-call limit is confirmed.
- Sections 1, 3 and 4, and the place of an approval (section 2): new questions.

## Ideas worth adopting
1. (Q1) One rule on the server for a busy chat, the Chief's and a bot's: accept the message and queue it. Never refuse, never start a parallel run. Claude Code, Cursor, OpenClaw, Devin.
2. (Q1) Show the queued message above the composer with remove and "send now"; removing puts the text back in the box. Claude Code, Claude desktop, OpenClaw.
3. (Q1) Keep Send while a run works and give Stop its own button. Claude desktop, Devin.
4. (Q1) Store the queued message before acknowledging it; after a restart mark it as not delivered. OpenClaw, Devin.
5. (Q1) Stop in the Chief chat stops the bot runs that turn started and drops its queued follow-ups; say so when a child could not be stopped. OpenClaw.
6. (Q2) Show the ask in the chat that caused it and keep it in Needs you; one answer closes both. OpenClaw (`session`, `targets`, `both`), Claude Code, Devin.
7. (Q2) Name the asking bot on a card shown in the Chief chat. Claude Code, Codex.
8. (Q2) While an ask is open, a typed "yes" in that chat answers the ask before anything else. OpenClaw.
9. (Q2, Q5) Hold the ask inside the paused tool call so Yes continues the same turn: a permission host for short waits, `defer` for long ones. Claude Code, OpenClaw, Devin.
10. (Q3) Send the question with the tapped answer ("Asked: … Answer: Yes"). Claude Agent SDK, Telegram, Slack.
11. (Q3) Rebuild history as: a summary of older turns, the recent turns whole, open asks kept word for word. Or resume the bot chat's session file. OpenClaw, Claude Code.
12. (Q4) Keep the approved job running. Store the edit as a pending draft; approving replaces the job, declining drops the draft only. Zapier, n8n.
13. (Q4) Put the difference on the card: old and new schedule, prompt edits as a line diff. Devin, n8n.
14. (Q4) Never leave a job switched off while it waits for an approval. OpenClaw.

## Solutions that make part of botdot unnecessary
None replaces the product. Three parts of Claude Code need not be built again, each after a trial. A permission host (`--permission-prompt-tool`) already holds an ask open in a live `claude -p` run and continues the same turn; `defer` does it across a process exit. `--input-format stream-json` already queues messages into a running process, which fits the Chief's resumed session. `--resume` with a bot chat's session already returns the full history, which the three-run reconstruction approximates; it conflicts with "a fresh run per message" and would need an ADR.

## Uncertainties resolved at stage 4

All by reading the code at `6547da9` on 2026-10-05; nothing was run. Two architecture decisions are proposed: [ADR 009](../adr/009-the-botdot-server-carries-on-after-an-ok.md) and [ADR 010](../adr/010-a-connected-app-action-waits-in-its-run.md). None of the findings changes the agreed outcome or scope.

- **Can a bot be started again from a run's record?** Yes. The record keeps the request as the owner wrote it, with no history in it (`prompt`, `customPrompt`), the attachments, which stay in the workspace's `uploads/`, and `trigger`, `jobId`, `startedBy`, `fromBot`, `chainId` (`lib/bots.js:878-895`). Not kept: the Chief's chat, which `chatThatStarted(runId)` finds from the chat files, also after a restart (`lib/chief.js:268-271`); and a one-time job, which is removed as its run starts and must be carried with the work, as QW-009 did for a script's follow-up.
- **Does the ask know its run?** Not today, and it can. The run id is in scope where a refused tool makes its ask (`lib/bots.js:1024`, during the `result` event, before the run ends) and where `ask_permission` and `ask_skill` make theirs (`server.js:1112`, `1136`); neither passes it. One run can make several asks. A second run that is refused the same permission gets the first run's ask back unchanged (`lib/asks.js:42`), so an ask must keep every run that waits for it.
- **Can botdot tell who started a run?** Yes, with one gap: the owner's message and a Board tile's are the same call (`server.js:76`, `1499`). A tile is the owner's tap, so it is treated as the owner's.
- **Can "the owner asked again" be decided?** For a bot: a run started by the owner after the ask's time. For the Chief: an owner's message in that chat after it; `ownerWrote` returns no time today (`lib/chief.js:727-730`), the messages have one.
- **Can the hand-off's follow-up be reused?** Its queue pattern, not its text: a plain item in `data/queue.json` with a key that keeps it single, and a kind `startQueued` knows (`lib/bots.js:1325-1348`). `followUpPrompt` is built from a wait's answers and passes no files.
- **A teammate's request.** The asker's wait ends when the refused run ends (`lib/bots.js:972`), and since QW-004 the asker is then started again. The answer of the run that carries on cannot use that wait: it goes to the asker as a message from the bot.
- **Is a waiting turn of the Chief plain data?** Yes: `{ prompt, message, otherwise }` (`lib/chief.js:666`). It can be written to disk as it is. A chat that was deleted falls back to the chat that started the run, the last one used, then a new one (`:676-682`). With Claude signed out the turn fails and `otherwise` is posted.
- **Does the Chief's chat id reach a job, a tile or a bot change?** No. The Chief's tools server sends only its key (`lib/mcp-server.js:14`); `CHIEF_CHAT_ID` goes with tool asks and reminders. It has to be sent with every call and kept with the ask, the job and the tile.
- **Can `connector_run` wait?** Yes. Bots only call it (`lib/bots.js:837-843`, `server.js:680-682`). The login wait is the model: slices of 25 seconds on the server (`lib/login-requests.js:54-62`), a loop in the bot's tools server that leaves the call unanswered (`lib/vault-mcp.js:75-81`), under Claude's own limit of 15 minutes for one call (`lib/bots.js:981`). Asks have no such wait and no signal for a decline yet. While a connected-app ask waits the bot's face already reads `needs_you` (`server.js:263-266`). The line "Waiting for your OK" has no carrier: the run needs a field for it.
- **Does a late OK meet the same arguments?** Only when the bot is handed them. The grant matches a hash of the exact arguments (`lib/connector-approvals.js:5-6`), and a bot started again would write its email anew. The run that carries on is given the ask's stored arguments word for word. The grant is in memory today, keyed by the run; a late one is kept with the queued work and bound to the run when it starts.
- **One card per grant without touching the binding.** `docs/security-issue-90.md` says an approval binds the proposal to the previous values and stale edits fail; a test pins the 409 (`test/owner-approval.test.js:50-53`). The rule that needs no change to it: no permission ask is made while a waiting bot change already holds that permission, and a new bot change takes over a waiting permission ask for the same one.
- **Android.** Both chats already draw cards (`ChatNeeds`), the Chief's chat with a filter that leaves bot changes out (`data/Models.kt:294-298`), as the web page's (`public/app.js:4636-4639`). A connected-app card draws its `details` as text; rows exist for tools only.
- **The gates.** `MILESTONE_STAGES` is `tools-real`; `RESILIENCE_STAGES` is the Android build, tests and lint. The last task gate took 118 of its 180 seconds: every new test of a wait sets the wait short.
- **Not resolved, and where it is decided:** that a bot started again does not repeat what it did, and that the Chief starts a bot after being told, are model behaviour: the owner's checklist and A20.
