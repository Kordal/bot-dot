# Milestone 8 research: what the interaction audit leaves open

Planning status: stage 6 closed on 2026-10-06; next: delivery, starting with SURE-001 or SURE-004.

Date: 2026-10-06. Revision inspected: `main` at `57336cb` (Milestone 7 is merged through pull request 266, the feature "A bot remembers its chat" through pull request 268, and the quick change that removed the API price line through pull request 270). `node scripts/agent-local.mjs phase` prints `between`: every task is done, and `docs/plans/planned/` and `active/` are empty. No product tests were rerun and no product was started. This note is research evidence, not an implementation plan.

## Why this milestone

On 2026-10-06 the owner asked what [the interaction audit](../../product/improvements/2026-10-05-bot-interaction-audit.md) still leaves open. [Milestone 5](../../product/milestone5.md) delivered its quick wins, [Milestone 6](../../product/milestone6.md) its two critical findings (an OK continues the work, a connected-app action waits), [Milestone 7](../../product/milestone7.md) its finding 4 and its failure hygiene (busy and stopped), and CHAT-001 its finding 5 (a bot remembers its chat). Of the audit's ten findings, 1 to 9 are delivered. Finding 10, a shared voice, is open, and so are three of its nine structural changes and a list of smaller points from its sections 4 to 6.

## What the product delivers today

After Milestone 7 the owner's message to a working bot or a replying Chief waits its turn, Stop ends what it started, a late result is a short turn of the Chief, and a failing job is said once and not at night. After CHAT-001 a bot is handed its chat as the owner saw it.

Each claim below is one the audit made and no milestone has delivered. Each was looked up again at `57336cb` on 2026-10-06 by three readers (the server and the prompts, the web page, Android), each given the audit's claim and told to refute it. All hold unless the table says otherwise.

### Approvals

| Area | Verified at `57336cb` |
| --- | --- |
| A changed job stops | Nothing is staged: a changed job is written over in place with `approved` false, and it runs only when `enabled && approved` (`lib/jobs.js:41`, `80-81`). The card says "Wants to add a" job or script for a change too (`lib/asks.js:404`, `406`). Decline removes the whole job (`server.js:1682`) |
| What asks again | **Wider than the audit:** a change of `cron`, `at`, `notify`, `aiWhen` or the prompt asks again, and so does any change a bot makes to its own AI job. `alwaysApprove` switches it off per job |
| A Board tile | Decline removes it (`lib/dashboard.js:360`). **Narrower than the audit:** a tile asks again only when its script changed (`:248-249`) |
| Decline on a job says too little | Web page: the job dialog says "Decline and remove"; the card in Needs you and in the chat says "Decline", asks "Remove this job?", then reads "Declined" (`public/app.js:3237`, `4846`). Android: no question, the job is removed and reads "Declined", in the Needs-you card, the card in the chat and the notification (`ui/NeedsYouScreen.kt:247`, `355`; `feed/Notifier.kt:606`) |
| "Approve all" | Both apps: one tap approves every waiting job, script jobs included, and settles every shared-memory change, with no question, behind folded cards (`public/app.js:4823-4834`; `ui/NeedsYouScreen.kt:194-198`). It skips the script warning that "Always approve" shows, and the rule that a script's yes is given on its card |
| "Always allow this action" | The web page asks first (`public/app.js:4845`); Android answers at once (`ui/NeedsYouScreen.kt:822`) |
| A bot's own proposal | After the owner's yes on a job, a tile or a change to its instructions that a bot proposed itself, nothing carries on and the bot is not told (`server.js:1681-1686`, `1536-1538`; the instructions part inferred). The machinery of Milestone 6 exists (`carryOnAfter`, `tellChiefOfAnswer`); such an ask lacks the link to a run or a chat |
| Who asked decides | An AI job needs a card when a bot adds it and none when the Chief does (`lib/jobs.js:44`). Deliberate; the audit asked for one owner decision |
| A declined permission | Remembered for 7 days (`lib/asks.js:21`). An ask cannot be taken back other than by declining |
| `delete_bot` | Guarded by a boolean the model sets (`lib/mcp-server.js:587-592`), also in turns botdot starts. The look cannot delete: it has no such tool |
| The backup passphrase | Setting it up uses two password fields. Changing it still uses a clear-text browser prompt, with no second entry (`public/app.js:4051`) |

### Words

| Area | Verified at `57336cb` |
| --- | --- |
| Three style blocks | The Chief's "How to work", the bots' `FRIENDLY_STYLE` and the look's `SYSTEM` are written separately (`lib/chief.js:99-101`, `lib/bots.js:52`, `lib/look.js:67-71`). No shared constant. The Chief's prompt says "the user", the other two "the owner" |
| Progress words, a bot | **Changed:** the server gives a `text` for every tool of a bot's run (`server.js:543`, `555`). Those words are past tense and shared with the memory index (`lib/memory.js:56`): rewording them changes what recall stores |
| Progress words, the Chief | The server sends `text` for "Thinking" and "Waiting for <bot>" only (`lib/chief.js:608-616`). Both apps prefer the server's text and fall back to their own table: the web page to "Working on it" (`public/app.js:1931`), Android to the raw tool name in words (`ui/ChiefScreen.kt:389`) |
| End-state words | The server writes the problem sentence (`lib/problems.js`). Each app still writes the rest: "Couldn't finish" in the list, "Done. (No written reply.)" or "Done." for an empty reply, "Stopped" where the server sent no sentence, the notifications' "Done.", "Replied." and "Didn't finish" (`public/app.js:660`, `1874`, `2568`; `ui/HomeScreen.kt:497-498`, `ui/BotChatScreen.kt:234`, `feed/Notifier.kt:619`, `662`). Android's home list ignores the server's sentence |
| A second table | The web page keeps a copy of the server's problem table as a fallback (`public/app.js:1756-1777`) |
| A wrong sentence | The server's table matches on the reply's text whatever the run's kind, so a failed script whose output holds "429" or "/login" gets Claude's sentence (`lib/problems.js:21-35`) |
| Chips | Written in one place (`lib/chief.js:438-459`). Left: "(no AI)" on a job's chip, a skill's slug |
| Names | **Changed:** the place is "Needs you" in both apps. The state under it has four wordings: "Waiting for your OK", "Waits for your OK", "Needs your OK", "N things wait for your OK" |
| Markdown | The web page restarts a loose numbered list at 1, flattens a nested one, and draws no quote and no rule; a paragraph of several lines becomes one paragraph per line (`public/app.js:338-375`). Android draws all of them (`ui/Markdown.kt:157`, `190-197`). No fixture is shared: each has its own tests |
| botdot's own lines | **Changed:** they carry marks (`notice`, `reminder`, `unasked`, `role: 'report'`), not one `kind`. `docs/api.md:198` still says of a notice "draw it as a Chief message" |
| Raw errors | The catch-all answers any thrown error's message as a 400, unlogged (`server.js:2156-2157`). Excluded by Milestone 7 |
| Cost | Gone from the Chief's tools, from both apps' screens and from Settings. **Still sent:** `costUsd` in the feed's run summary, the `chief_reply` event and stored chats, and each model's `price` in the settings API (`lib/events.js:71`, `lib/settings.js:195`). Android parses `costUsd` and uses it nowhere |

### Left hanging

| Area | Verified at `57336cb` |
| --- | --- |
| A bot's open question | A reply with answer buttons or a question card looks like a finished reply everywhere outside the open chat: the feed's run summary carries neither, and no "asks you" state exists (`lib/events.js:60-78`, `server.js:469-480`, `public/app.js:660`, `ui/HomeScreen.kt:492-499`) |
| A question that vanishes | **Worse than the audit:** a scheduled run whose reply is only a question is stored with an empty result (`lib/choices.js:46`), which makes it a quiet run: no bubble, no notification (`lib/problems.js:46-47`) |
| A question for nobody | A run the Chief started still makes buttons for the owner; the Chief is handed the text without them (`lib/bots.js:846`, `1108-1111`; `lib/chief.js:1030`) |
| A Board tile that asks a bot | "Asked X", or "X will do it when it is free", for 2.5 seconds, then nothing. The answer carries the run's id and neither app follows it (`public/app.js:5420`; `ui/DashboardScreen.kt:115`) |
| A failed request | No retry: "Run again" on the web page opens the main assignment, a failed bubble has no button, and the server has no route that repeats a run (`public/app.js:1792`, `1854-1858`) |
| The web page's history | **Changed in part:** the chat draws 40 runs and reads back to the "New" line. There is still no scroll-back. The server already pages (`/runs?botId=&before=`), and Android uses it in both chats |
| A file sent during a run | In a run the owner started it is written to the run's own stream and announced nowhere (`lib/bots.js:1376-1380`). In a run the Chief started it is posted to the Chief's chat |
| botdot unreachable, on Android | Inside a chat nothing says so until a send fails; the home screen and the status notification do (`ui/HomeScreen.kt:485-489`) |
| Existing jobs | A job without `notify` stays report-only (`lib/jobs.js:55`); the prompts now pick "always" for a report the owner asked for |

### The Chief as helper

| Area | Verified at `57336cb` |
| --- | --- |
| A bug report | `runSummary` hands the Chief no job name and no problem sentence (`lib/mcp-server.js:48-55`). No tool lists the asks, the login requests or the tile suggestions that wait. It does see a job's `approved: false`, the job's line, pending tiles and a count of memory changes |
| "This bot" | The Chief's per-turn note has shared memory, the time and mentions (`lib/chief.js:185`). Which bot's chat the owner had open last is not in it; the server keeps read times per chat (`lib/read.js:60-84`) and would have to derive it (inferred) |
| "Improve this bot" | The prompt has a rule for a new bot, at most two questions (`lib/chief.js:102`), and none for an existing one. Bots have no rule on when to ask |
| The look | The owner's next message in that chat counts as the answer to the look's unasked message, whatever it says (`lib/chief.js:514-516`). Changing it needs an update of [ADR 006](../../adr/006-a-look-is-its-own-read-only-chief-session.md) |

### Settings

The web page's bot and job panels still let the owner edit by hand what the Chief changes by chat, and show internals: an "Allowed tools" field with `Bash(pytest:*)`, the permission modes by their keys (`dontAsk`, `acceptEdits`, `bypassPermissions`), a raw cron field and `$JOB_STATE_DIR` (`public/app.js:1199-1201`, `3056-3071`). The first two sit behind Advanced. Android has no permission-mode control and shows almost no internals. The older run page (`public/app.js:1499-1920`) holds most of what is left: raw status words, the page's own tool table, the session id.

## Evidence boundaries

- Every code fact above was read by an agent on 2026-10-06 and not exercised: no server was started and no message was sent.
- What the Chief and the bots say is model behaviour: whether one shared style block makes them sound alike is seen only in use.
- How often the owner changes an approved job, taps "Approve all", or gets a question from a scheduled run is not measured. Real use of Milestones 5, 6 and 7 on the owner's own server is still open.
- The audit did not cover the first run and pairing, updates and backups, and several Android settings screens. Nothing here does either.
- Sizes are the auditors' estimates and this session's reading.

## Evidence and candidate improvements

| Evidence | Candidate improvement |
| --- | --- |
| A changed job stops until approved and Decline deletes it; the card says "add" (verified). | Staged changes: the approved version keeps running, the card says "changed" and shows what, Decline restores it. The audit's structural change 6. |
| "Approve all" approves scripts unseen; Android's Decline removes a job without a word; Android's "Always allow" asks nothing (verified). | "Approve all" leaves out what a card must show; Decline says what it does, the same in both apps. |
| A bot's own proposal carries on nothing (verified). Excluded by Milestone 6. | The ask keeps the run that proposed it, and the bot is told after the yes. |
| A bot's open question has no state, and a scheduled run's question vanishes (verified). | "Asks you" is a state the server hands out: the list and the phone show it, and a question is never a quiet run. |
| A Board tile forgets the run it started (verified). Excluded by Milestone 7. | The tile shows working, done or failed for that run. |
| A failed request has no retry (verified). | "Try again" under a failed reply sends the same request and files. |
| The web page has no scroll-back; the server pages already (verified). | The web page loads older runs as Android does. A change of the page only. |
| Three style blocks; the Chief's progress words and the end-state words are written per app (verified). | One voice block for the three prompts; the Chief's progress words and the end-state words written on the server. The audit's finding 10 and structural change 7. Not chosen by the owner for Milestones 5, 6 and 7. |
| The web page's Markdown draws less than Android's; no shared fixture (verified). | One fixture both renderers are tested against; the web page draws what Android draws. |
| `costUsd` and `price` are still sent to the apps (verified). | They leave the API. A change of the contract: `docs/api.md`. |
| The Chief cannot see what waits, nor a run's problem sentence (verified). | `runSummary` keeps the job's name and the problem; one read-only tool lists what waits. |
| No rule for "improve this bot"; "this bot" has no referent (verified, the second inferred). | A rule in the prompt; the per-turn note names the chat the owner had open last. |

## Carried forward

- Milestone 7: real use (B23) on the owner's server; the low findings under Follow-up of [milestone7-test.md](../../product/milestone7-test.md). Those that touch the candidates: a job that fails and works in turn through the night gets one morning line per row of failures; times on a job's line are in the server's time zone; deleting a bot with messages waiting takes several steps.
- Milestone 6: real use (A20); the low findings of [milestone6-test.md](../../product/milestone6-test.md). Its exclusions still open: a bot's own proposal that interrupted nothing, taking back an ask, staged changes.
- Milestone 5: real use (A20); its exclusions still open: a "Can't reach botdot" line inside Android's chats, a retry by botdot of a failed message.
- Milestone 3: real use (A14); the look's "answered" rule and ADR 006.
- Browser tests run in no gate: the repository does not carry Playwright.
- Improvement reports: "Board" proposals 4 and 5 are marked later.
- Issues: 269 (Vault: SSH keys, needs rework), 254 (updates fill the disk with old images, needs review), 9 (security findings before an open-source release, blocked on the release scan). None is part of this.
- No task is unfinished and nothing is blocked from outside.

## Proposed boundary for the discussion

Four groups, for the owner's choice at stage 2. Each stands alone.

1. **Approvals you can trust.** Staged job and tile changes; "Approve all" without scripts; Decline that says what it does, the same in both apps; a bot's own proposal carries on.
2. **Nothing left hanging.** A bot's open question is a state and never quiet; a Board tile follows its run; "Try again" on a failed request; scroll-back on the web page; "Can't reach botdot" inside Android's chats.
3. **One voice.** A shared style block; the Chief's progress words and the end-state words written on the server; a shared Markdown fixture; cost out of the API.
4. **The Chief as helper.** What waits and what failed, readable by the Chief; "this bot"; a rule for improving a bot.

Out, whatever is chosen: a message that steers a turn already going; a shorter wait of the Chief; trimming the settings panels (it removes controls the owner may use, and needs its own decision); the first run, updates and backups; new settings; anything that shows costs; the Mac app ([ADR 008](../../adr/008-the-mac-app-is-no-longer-developed.md)).

Three things a plan would get wrong by trusting the audit: re-approval covers far more than a script's time, so "staged" has to say for each field whether it asks at all; the bots' progress words are also what recall stores, so rewording them is not free; and removing cost is a change of the API, not of a screen.

## Existing solutions

Date: 2026-10-06. A delta on the Milestone 5, 6 and 7 notes. Every page was read raw with curl today: Markdown twins, HTML with the tags stripped by a local script, GitHub's article API, Zapier's help-centre API, Devin's OpenAPI file. No summarising tool was used on a page. A web search was used twice, to look for a Claude and a Cursor page about retry; it found no new primary page. "Unverified": no primary page gave the fact. "Not documented": the pages opened do not say. help.openai.com was not tried.

### 1. Editing an automation that is already approved or live

The Milestone 6 note, section 4, covers Zapier, n8n, Make, GitHub deployment reviews, OpenClaw and Devin. Only what is new is below.

#### Zapier
https://help.zapier.com/hc/en-us/articles/9693520498445
- Reused: "Edit the draft while the Zap continues to run." "Deleting a draft is permanent and no changes are made to the current published Zap."
- New, a published Zap cannot be edited in place: "When you reopen a Zap after publishing it, the Zap will be in read-only mode."
- New, the draft starts from what runs: "When you edit your Zap, drafts are created from the version that's currently in use."
- New, a diff before publish: "An outline of the current published Zap version will be displayed next to an outline of your draft version."
- New, roll back: "create a new draft based on a previous version of your Zap". "Versions can be renamed, but can't be changed or deleted. You can only delete the current draft."
- Overlap: botdot's changed job. Better: the live version is read-only, so an edit can only ever be a draft.

#### n8n
https://docs.n8n.io/build/understand-workflows/save-and-publish-workflows, https://docs.n8n.io/build/build-and-manage-agents
- Reused: "Production executions will use this published version, not your latest edits."
- New, a state of its own on the button: "**Published, has changes** The workflow is published, but you've made changes since the last publish that haven't gone live yet."
- New, publishing touches only what changed: "n8n works out which triggers changed between your last published version and the new one, then applies only those changes in the background. Triggers that haven't changed keep running without interruption."
- New, a broken edit does not stop the live version: "**Published, error** The workflow is published, but there are errors in your recent changes that need to be fixed before you can publish again."
- New, n8n agents with schedules work the same: "Publishing takes a snapshot of the draft, so the running agent doesn't change while you edit." "The published version is what runs when someone chats with the agent, a channel triggers it, or a schedule fires."
- Overlap: closest to botdot (an agent with a schedule). Better: "published, has changes" is one visible state; the old schedule keeps firing.

#### Make
https://help.make.com/restore-and-recover-scenario, https://help.make.com/active-and-inactive-scenarios, https://help.make.com/schedule-a-scenario
- Nothing new. Manual saves, a version history kept "for up to 60 days". Draft versus published, and when a saved edit reaches an active scenario: not documented on these pages.

#### Home Assistant
https://www.home-assistant.io/docs/automation/editor/, https://www.home-assistant.io/docs/automation/modes/
- No draft: "After changing a trigger, condition, or action, select Save to apply your changes to the automation." Before saving, "you can undo and redo your changes".
- Off is a separate switch: "Disable: Turns off the automation, so it doesn't react to its triggers."
- What a save does to a run in progress: not documented on these pages.
- Different: one owner, no approval, so the edit is live at once. The unsaved editor is the only "draft".

#### GitHub Actions
https://docs.github.com/en/actions/how-tos/manage-workflow-runs/approve-runs-from-forks, https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository
- The approval is on a run of proposed changes, by who proposed them: "By default, all first-time contributors require approval to run workflows."
- The reviewer is told what to read: "You should be especially alert to any proposed changes in the `.github/workflows/` directory that affect workflow files."
- A pending approval ends by itself: "Workflow runs that have been awaiting approval for more than 30 days expire and are marked as failed. An annotation explains that the approval expired."
- The trusted version is not held: "workflows triggered by these events will always run, regardless of approval settings" (`pull_request_target`, which runs "in the context of the base branch").
- Different: the gate follows trust in the author, not the fact of a change. Better: an unanswered approval expires with a reason instead of blocking for ever.

#### OpenClaw automations
https://docs.openclaw.ai/tools/exec-approvals, https://docs.openclaw.ai/automation/cron-jobs/payloads
- Reused: an edit applies at once; there is no draft.
- New, an edit withdraws the standing permission, not the job: "A grant fails closed back to a normal prompt when the job is deleted or its substantive definition changes, even if a later edit restores the earlier definition."
- New, a pause is not a change: "Pausing and re-enabling the unchanged automation preserves the grant."
- New, an edit during a run wins: "The check runs immediately before the process spawns, so a revocation or job edit that lands mid-flight still wins."
- New, cosmetic edits are exempt: "Description and display-label changes preserve it" (the job's authorisation).
- Overlap: the closest product. Better: the job keeps its schedule after an edit; only the risky step asks again, at the moment it would run.

#### Claude Code and Claude Desktop scheduled tasks
https://code.claude.com/docs/en/desktop-scheduled-tasks, https://code.claude.com/docs/en/routines, https://code.claude.com/docs/en/scheduled-tasks
- No draft and no approval of an edit. Desktop: "Changes take effect on the next run." Routines (network policy): "The new policy applies from the next run."
- A task may edit itself: "A scheduled task can also modify its own schedule or prompt from within a running session using the `update_scheduled_task` MCP tool."
- Pause is separate from delete: "toggle between Active and Paused to pause or resume scheduled runs without deleting the task".
- Permissions belong to the task: "Future runs of that task auto-approve the same tools without prompting. You can review and revoke these approvals from the task's detail page." Whether an edited prompt clears them: not documented.
- `/loop`: "Edits to `loop.md` take effect on the next iteration, so you can refine the instructions while a loop is running."
- Different: the run in progress finishes on the old text; the next run uses the new one.

#### Devin
https://docs.devin.ai/product-guides/automations, https://docs.devin.ai/product-guides/scheduled-sessions, https://docs.devin.ai/release-notes/2026
- Reused: "Approving an automation update now shows exactly what changes" (2026-09-09).
- New, schedules are now automations: "Schedules is a legacy feature — new scheduled work is created as an automation."
- New, off keeps everything: "Disabled automations stop processing events but retain their configuration."
- New, the card is compact: "The \"automation created/updated\" and approval cards in chat now show a compact, collapsible summary of the automation" (2026-10-02).
- Whether the old version runs while an update waits, and what declining does: still not documented.

### 2. Bulk approval

No product opened has one button that approves every pending request of an agent. Each widens one approval instead, and keeps risky kinds out of the wider scope.

#### Claude Code
https://code.claude.com/docs/en/permissions, https://code.claude.com/docs/en/permission-modes, https://code.claude.com/docs/en/agent-view
- An "approve all" for several pending prompts: not documented. Every prompt is answered by itself.
- The wider answer differs by kind. A shell command: "Permanently per repository and command". A file edit: "Until session end".
- The wider answer is withheld when it cannot be shown: "Claude Code offers those options only when the prompt can show you everything they would allow, so a rule you save from a prompt covers only what its option named."
- The bulk mode leaves commands out: `acceptEdits` approves file edits, while "all other Bash commands except the built-in read-only set still prompt".
- Not from the list: in agent view, for a permission prompt "replying doesn't answer it. Your reply waits in the queue. To answer the dialog, attach with `→`".
- Some tools can never be pre-approved: tools marked `requiresUserInteraction` "prompt on every call and don't offer an always-allow option" (https://code.claude.com/docs/en/desktop-scheduled-tasks).
- Overlap: botdot's own engine. Better: the bulk path exists only for the low-risk kind.

#### Codex
https://learn.chatgpt.com/docs/app-server, https://learn.chatgpt.com/docs/sandboxing/auto-review, https://learn.chatgpt.com/docs/agent-configuration/rules
- "Approve all": not documented. Decisions are per request: "`accept`, `acceptForSession`, `decline`, `cancel`".
- The server says which answers a client may offer: the request carries "optional `availableDecisions`".
- Grouping only of identical asks: "Codex groups concurrent network approval prompts by destination", so "one prompt that unblocks multiple queued requests to the same destination".
- Risky kinds always ask: "Destructive tool annotations always trigger approval even when the tool also advertises less-privileged hints."
- An override is narrow: "it applies to the exact denied action, not similar future actions".
- Rules: "Codex applies the most restrictive decision when more than one rule matches (`forbidden` > `prompt` > `allow`)."

#### Cursor
https://cursor.com/docs/agent/security/run-modes
- "Approve all" for pending prompts: not documented. The bulk choice is a mode: "**Run Everything** | Every tool call runs automatically."
- Risky kinds are carved out of the automatic modes: "These protections can require approval even when a mode would otherwise run automatically". "**File-Deletion Protection** | Prevents the agent from automatically deleting files, including `rm` commands."

#### OpenClaw
https://docs.openclaw.ai/tools/exec-approvals, https://docs.openclaw.ai/tools/exec-approvals-advanced, https://docs.openclaw.ai/cli/approvals, https://docs.openclaw.ai/web/control-ui/sessions-and-sidebar
- "Approve all": not documented. One id per decision: `openclaw approvals resolve <id> <allow-once|allow-always|deny>`. "An `allow-once` grant covers only its specific command; subsequent commands receive their own policy decision."
- Scripts are kept out of the durable answer: "`allow-always` does not persist new allowlist entries for inline-eval commands." "Mutable file operands and commands that require explicit review (heredocs, strict inline eval, audit suppression) keep prompting per occurrence."
- A script that changed after the yes does not run: "If that file changes after approval but before execution, the run is denied instead of executing drifted content."
- The request limits its own buttons: "approval surfaces use the request's declared decision set, and the Gateway rejects attempts to submit a decision that was not offered."
- The card says how far the yes reaches: "automation approvals carry a scope line describing exactly what Always allow will mint."
- Never a pile per job: "Automations are single-flight, so at most one card per job is pending at a time."
- The list shows a count, not a bulk button: the tooltip has "the oldest question, compact command, or approval title, plus a count of additional questions or approvals".
- Overlap: closest to botdot's script jobs. Better: a script is bound to its exact content and never rides on a wider yes.

#### Devin
https://docs.devin.ai/cli/reference/permissions, https://docs.devin.ai/release-notes/2026
- Web app: an "approve all" for pending approvals is not documented. The sidebar names each one: "Approve skill", "Approve playbook", "Approve sessions" (2026-09-30).
- CLI, bulk by source: for an MCP tool prompt, "Allow all tools on this server (this session)".
- CLI, risky kinds never ride along: "Some categories are **never** auto-approved in Smart mode, no matter what the model thinks", among them "`rm`, `sudo`, and other destructive or privilege-escalating commands".
- Bulk by a named class exists elsewhere in Devin: "click \"+ Select all Critical\" (or High, Medium, Low)" on security findings (2026-10-02). Not for approvals.

#### GitHub pending-deployment reviews
https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments, https://docs.github.com/en/rest/actions/workflow-runs
- Yes, by selection, within one run: "Select the job environment(s) to approve or reject. Optionally, leave a comment." The API takes "`environment_ids` (array of integers) (required)" and one `state`.
- The all-at-once path is a named bypass with a second step: "Start all waiting jobs", then "enter a description for bypassing the deployment protection rules", then "**I understand the consequences, start deploying**".
- It can be switched off: not available "if the environment has been configured to prevent admins from bypassing configured protection rules".
- An "approve all" across runs: not documented.
- Better: the owner ticks what one yes covers; "all" needs a reason and a confirmation.

### 3. An agent that ended its turn with a question

#### Claude Code (agent view, projects, desktop)
https://code.claude.com/docs/en/agent-view, https://code.claude.com/docs/en/claude-projects, https://claude.com/docs/cowork/changelog
- A state of its own, on top: "Needs input | Yellow | Claude is waiting on something only you can provide: an answer to a question, a permission decision, or another prompt only you can answer". Groups are ordered "so the ones that need input are at the top".
- The row carries the question: "a blocked row shows the question it's asking". The peek panel shows "the exact question it's asking, above the reply input" and "a line such as `waiting 3m`".
- Waiting for an answer is not the same as finished: "A session that finished its turn and is waiting for your next instruction reads `done`, not `blocked`. `blocked` always means the session needs something from you before it can continue."
- The cause is data: `waitingFor` is "`permission prompt` for an approval, `input needed` for a question from Claude or an MCP server's input request".
- A count outside the list: the prompt footer shows "`← 2 agents`"; the tab title shows "`2 awaiting input · claude agents`".
- A notification: "when a local background session starts needing your input, finishes, or fails". Scheduled sessions "notify only when they need your input".
- The wording is written in one place: "The one-line summary in each row is generated by a Haiku-class model".
- Projects: "**Waiting on you** | Threads that need your reply or approval, or that failed"; the Overview button "shows a dot when a thread is waiting on you".
- Desktop: the marker must survive a restart; a fix for "the sidebar losing their needs-input marker on restart" (2026-09-22).
- How a plain-text question at the end of a turn is told from a finished turn: not documented.
- Overlap: botdot's bot list. Better: one state, the question on the row, the wait time, a count, a notification.

#### Codex
https://learn.chatgpt.com/docs/notifications, https://learn.chatgpt.com/docs/pets, https://learn.chatgpt.com/docs/features/codex-micro, https://learn.chatgpt.com/docs/app-server
- A state of its own: "**Needs input** | A chat needs your approval, answer, or another decision." It differs from "**Ready** | A chat has completed and has unread activity."
- An order of urgency: "the pet prioritizes chats that need input, followed by blocked, ready, and running chats."
- A list of them: Activity view shows "chats that are unread, running, or waiting for your response".
- Its own notification switch: "Separate controls let you turn permission and question notifications on or off."
- A colour: "Amber | Requires input | ChatGPT needs your approval or response."
- In the protocol the wait is a flag on a running thread: `"status": { "type": "active", "activeFlags": ["waitingOnApproval"] }`. Questions are a tool: "`tool/requestUserInput` - prompt the user with 1-3 short questions".
- Whether a plain-text question at the end of a turn counts as "Needs input" or "Ready": not documented.

#### Cursor
https://cursor.com/docs/agent/overview, https://cursor.com/docs/cloud-agent/mobile, https://cursor.com/docs/cloud-agent/api/webhooks, https://cursor.com/docs/agent/agents-window
- A question does not stop the agent: "While waiting for your response, the agent continues reading files, making edits, or running commands."
- The notification is for a finished turn, not for a question: "Get a push notification when an agent finishes a turn".
- Webhooks: "only `statusChange` events are supported, specifically when an agent encounters an `ERROR` or `FINISHED` state."
- A "waiting for your answer" state or badge in the Agents Window: not documented.

#### Devin
https://docs.devin.ai/release-notes/2026, https://docs.devin.ai/v3-openapi.yaml
- A state of its own in the API: `status_detail` is "'waiting_for_user' (needs user input), 'waiting_for_approval' (awaiting action approval in safe mode), or 'finished' (task complete)".
- A group of its own: "Working / Ready / Blocked / Inactive, so sessions with a PR awaiting review and sessions that need your input are listed separately" (2026-09-25).
- A label on the row: "persistent status labels, such as \"PR created,\" \"Awaiting instructions,\" or \"Approve session,\"" and "an orange dot marks sessions with unread updates" (2026-05-08).
- A false alarm was removed: "removal of the misleading \"Action required\" label for Python sessions awaiting instructions" (2026-05-13).
- A question left behind is kept: "the transcript ... now shows the question as skipped, with what was asked" (2026-09-16).
- Better: "waiting for an answer" and "finished, unread" are different groups.

#### OpenClaw
https://docs.openclaw.ai/web/control-ui/sessions-and-sidebar, https://docs.openclaw.ai/tools/ask-user, https://docs.openclaw.ai/web/notifications
- An attention icon on the row, with the question behind it: "Pending questions and approvals show their specific request when you tap, hover, or keyboard-focus the attention icon."
- An order: "Questions and approvals take priority over agent attention notes and failed runs; requests at the same priority show the oldest first." "Requests for input and errors take priority over activity in the state slot".
- It shows even in the compact list: "Errors and requests for attention remain visible with previews off."
- A guessed wait is quieter than an asked one: "Observer assessments such as **stuck** or **waiting on user** stay with their session instead of opening a global toast over another conversation. This does not change explicit questions, approval requests".
- A notification kind of its own, off by default: account defaults "control approval requests and updates, agent completion, agent questions"; "every other attention category is opt-in".
- The question is a tool with an end: "The default timeout is 900 seconds." Then "the tool returns `status: \"no_answer\"`. The agent then continues with its best judgment."
- Only the main agent may ask: "Subagents and other non-primary runs do not receive it."
- Overlap: the same shape as the Chief and its bots. Better: two sources for one mark, an explicit question (certain) and an observer's guess (quiet).

### 4. One voice across several agents

#### Claude Agent SDK and Claude Code
https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts, https://code.claude.com/docs/en/output-styles, https://code.claude.com/docs/en/sub-agents, https://code.claude.com/docs/en/agent-sdk/typescript, https://code.claude.com/docs/en/agent-view
- A shared block is documented: "The following example pairs a shared `append` block with `excludeDynamicSections` so a fleet of agents can reuse the same cached system prompt".
- A style as a file: "Output styles are saved sets of instructions that change Claude's role, tone, and output format. They're stored as markdown files and can be reused across sessions and projects."
- It does not reach delegated agents: "a subagent runs its own system prompt, so your output style doesn't shape its responses, except in a fork".
- What does reach them: every custom subagent loads CLAUDE.md "unless its definition sets the `omitClaudeMd` field".
- A changed block is slow to arrive in a resumed session: "Claude Code records the system prompt on a session's first request and reuses that record until the session is compacted."
- Activity text from the engine, not the app: `SDKToolUseSummaryMessage` has `summary: string`; with `agentProgressSummaries` the SDK will "generate one-line progress summaries for subagents".
- A tool server can word its own progress: for a backgrounded MCP tool call, "`summary` carries the MCP server's latest reported progress".
- Agent view words every row with one model: "generated by a Haiku-class model", so that "A working row shows what the session says it's doing".
- Overlap: botdot's own engine; its bots are fresh `claude -p` runs, so `append` or a shared CLAUDE.md applies, an output style does not carry to subagents.

#### OpenClaw
https://docs.openclaw.ai/concepts/soul, https://docs.openclaw.ai/concepts/multi-agent, https://docs.openclaw.ai/concepts/system-prompt, https://docs.openclaw.ai/concepts/progress-drafts, https://docs.openclaw.ai/concepts/streaming, https://docs.openclaw.ai/web/control-ui/chat
- Voice is a file per agent, not shared: "Each agent gets its own workspace with `SOUL.md`, `AGENTS.md`, and optional `USER.md`". "`SOUL.md` is where your agent's voice lives."
- Rules and voice are split: "Keep `AGENTS.md` for operating rules; keep `SOUL.md` for voice, stance, and style."
- Sub-agents get the rules, not the voice: "Sub-agent sessions only inject `AGENTS.md`".
- One hook can swap the voice for all: "Internal hooks can intercept this step via the `agent:bootstrap` event to mutate or replace the injected bootstrap files (for example swapping `SOUL.md` for an alternate persona)."
- A shared style file for all agents: not documented.
- Status text is worded on the server and shown the same on every client: "the Gateway shows the model's latest safe preamble immediately as the session headline"; "It is shared with the official iOS and Android session lists."
- Status labels are configuration in one place: "`streaming.progress.labels` | built-in pool | Candidate labels used when `label: \"auto\"`".
- Its team preset matches botdot: "The chief of staff remains the human's point of contact".
- Better: the list's status line is one string from the server, for web and both phones.

#### Codex
https://learn.chatgpt.com/docs/agent-configuration/agents-md, https://learn.chatgpt.com/docs/customization/overview, https://learn.chatgpt.com/docs/agent-configuration/subagents, https://learn.chatgpt.com/docs/app-server
- One global file for tone: "Use the global file to shape how Codex communicates with you (for example, review style, verbosity, and defaults), and keep repo files focused on team and codebase rules."
- Layered, nearest last: "Codex concatenates files from the root down, joining them with blank lines."
- Each custom agent has its own `developer_instructions`: "Core instructions that define the agent's behavior." A style fragment shared between custom agents: not documented.
- A setting, not prose: a turn takes `"personality": "friendly"` and `"summary": "concise"`.
- Activity arrives as typed items the client words itself; `agentMessage` has a `phase` of "`commentary`, `final_answer`". Activity sentences supplied by the server: not documented.

### 5. Retrying a failed request

#### Claude apps and Claude Code
https://claude.com/docs/cowork/changelog, https://code.claude.com/docs/en/errors, https://code.claude.com/docs/en/agent-view, https://code.claude.com/docs/en/agent-sdk/typescript
- Desktop has "Try again" on a failed turn, and it carries the files. A fix reads: removing a file from the box "sometimes deleting that file from the message you had already sent, which made \"Try again\" on it fail" (2026-09-04).
- It must send once: a fix for a state that could "make Try again send an extra message" (2026-10-01).
- It survives a restart: "a failed send's retry card and prompt text now survive an app relaunch" (2026-08-06).
- Edit is the other way to resend: "Added an Edit button to your most recent message in Cowork and Chat sessions, so you can revise and resend it" (2026-09-04).
- The engine retries first: "Claude Code retries transient failures up to 10 times with exponential backoff before showing you an error."
- It does not retry what cannot succeed: a blocked output is shown "at once" and it "doesn't retry or re-send that request".
- The terminal has no button; the message is kept: "Your original message is still in the conversation, so for a long prompt you can type `try again` instead of pasting the whole thing."
- A reply that could not be delivered is stored: it "is saved and sent to the session as its next prompt when its process starts again, and the error message says the reply was saved."
- The engine says when a retry is pointless: `startup_failure_reason` exists "so your application can offer the fix instead of a retry".
- Overlap: botdot's own engine, which has already retried. Better: Try again on the failed turn, same text and files, once, kept across a restart.

#### OpenClaw
https://docs.openclaw.ai/web/control-ui/chat, https://docs.openclaw.ai/gateway/troubleshooting/agent-replies-and-control-ui
- A failed run in the main chat gets no resend: "Run-error banners offer **Refresh** to reload the conversation without resending a message or replacing your draft."
- No silent replay: "Storage failures do not trigger provider credential rotation or automatic replay of the run."
- The way back is the user's own message: "Rewind repoints the session to the state just before that message and returns its text to the composer for edit and resend".
- Retry exists where it is safe, the read-only side chat: "**Retry** resends that question in place." "A failed question keeps its image for **Retry** while the current pane is retained".
- Unsent files are kept: "A storage failure keeps those files available for retry."
- Different: no retry on a turn that may already have acted; retry where nothing can be done twice.

#### Codex
https://learn.chatgpt.com/docs/app-server
- A failed turn is typed: "the server emits an `error` event" and "finishes the turn with `status: \"failed\"`"; "it appears in `codexErrorInfo.httpStatusCode`".
- A retry button in the apps, or a resend call: not documented. `thread/rollback` "is deprecated".

#### Cursor
https://cursor.com/docs/agent/overview, https://cursor.com/help/troubleshooting/agent-issues, https://cursor.com/help/troubleshooting/network
- A retry on a failed agent turn: not documented. The troubleshooting pages say only "Wait a few minutes and try again".
- Checkpoints restore files, not the request: "Restoring a checkpoint reverts files only; it does not remove messages from the conversation."
- Unverified: a "Try again" button is named only in forum posts (forum.cursor.com), not in the documentation.

#### Devin
https://docs.devin.ai/release-notes/2026
- A retry of a failed turn with the same prompt: not documented.
- For a dead machine the card has two ways on: "\"Continue in a new session\" alongside \"Try restart\", with a note that machine-local files and running processes do not transfer" (2026-09-09).
- A failed answer keeps what was picked: "Restored question selections when an optimistic submit fails" (2026-06-03).

### Reused
- An edit to an approved, running automation (Zapier, n8n, Make, GitHub deployment reviews, OpenClaw, Devin): Milestone 6 note, section 4, 2026-10-05. Its finding stands: keep the approved version running, hold the edit as a draft, declining drops the draft only.
- Where an approval appears; "Needs input" at the top of Claude's agent view; Devin's sidebar groups: Milestone 6 note, section 2, 2026-10-05. Section 3 here adds the question state and its notification.
- A message that fails to send (Signal, Telegram, Claude desktop "Retry"): Milestone 5 note, section 1, 2026-10-05. Section 5 here is about a turn that failed after the send.
- A failing automation said once, time limits, who stopped a run, late results: Milestone 7 note, 2026-10-06. Not repeated.
- help.openai.com returns 403: Milestone 2, 3, 5, 6 and 7 notes. Not tried again.

### Refreshed or added
All 2026-10-06.
- Quiet hours for alerts: the Milestone 7 note says "not documented" for every product. OpenClaw has them for pushes: "Quiet hours suppress matching sends rather than queueing stale alerts for later delivery." (https://docs.openclaw.ai/web/notifications)
- Devin schedules are a legacy feature; scheduled work is an automation with a Schedule trigger.
- Home Assistant, GitHub fork-run approvals, Claude scheduled tasks and routines: new for question 1.
- Questions 2 to 5: new questions.

### Could not verify
- Make: draft versus published, and when a saved edit reaches an active scenario.
- Home Assistant: what a save does to a run in progress.
- Devin: whether the old automation runs while an update waits, and what declining does; an "approve all" in the web app.
- Claude Desktop scheduled tasks: whether editing a task's prompt clears its saved "always allowed" tools.
- Claude Code, Codex: how a plain-text question at the end of a turn is told from a finished turn. Both document the state, not the detection.
- Cursor: a "waiting for your answer" state in the Agents Window; a retry on a failed turn (forum posts only).
- OpenClaw: an "approve all"; a shared style file across agents; a retry button on a failed run in the main chat.
- Codex: an "approve all"; a style fragment shared between custom agents; a retry button; activity sentences supplied by the server.
- GitHub: an approval for several runs at once.
- ChatGPT (help.openai.com): not opened.

## Ideas worth adopting
1. (Q1) Keep the approved job running on its old text while a change waits. Show one state for it, "has a change waiting". n8n, Zapier.
2. (Q1) Decline drops the change, never the job. Zapier.
3. (Q1) A change of name or description needs no new approval; a change of what runs does. OpenClaw.
4. (Q1) If a job must ask again after an edit, ask at the step that is risky and keep the schedule. OpenClaw.
5. (Q1) Let a waiting approval expire with a stated reason. GitHub.
6. (Q2) Keep script and command jobs out of "Approve all"; each needs its own yes. Claude Code, OpenClaw, Cursor, Devin CLI.
7. (Q2) Let the server say which answers a card may offer, and refuse any other. Codex, OpenClaw.
8. (Q2) Say on the card what one yes covers. OpenClaw, GitHub.
9. (Q2) Tie a script's approval to its exact content; a changed script does not run on the old yes. OpenClaw.
10. (Q3) Give "waiting for your answer" its own state in the list, above working and finished, and never the same as "finished, unread". Claude Code, Codex, Devin.
11. (Q3) Put the question itself on the row, with how long it has waited. Claude Code, OpenClaw.
12. (Q3) Send one notification when a bot starts waiting for an answer. Claude Code, Codex, OpenClaw.
13. (Q3) Trust an explicit question more than a guess from the text; show a guess quietly. OpenClaw.
14. (Q4) One shared style block appended to every bot's and the Chief's prompt, kept in one file. Claude Agent SDK.
15. (Q4) Word status and activity text once on the server and send it as data to the web page and Android. OpenClaw, Claude Code. This is the existing rule of ADR 003 applied to text.
16. (Q5) "Try again" on the failed turn: the same text and attachments, sent once, kept across a restart. Claude desktop.
17. (Q5) Offer no retry when it cannot work or the turn may already have acted; say what to fix instead. Claude Agent SDK, OpenClaw.


Not adopted without an owner decision: a change of a job's name alone that asks nothing, and an approval that follows a script's exact content (ideas 3, 4 and 9), change which edits ask again, which the scope leaves as it is; a waiting approval that expires (idea 5); "Try again" and one voice (ideas 14 to 17) belong to the groups not chosen.

## Solutions that make part of botdot unnecessary

None. No product read has a bot that proposes a change to its own schedule and waits for its owner; n8n and Zapier keep the live version running because a person edits a draft. That is the shape to copy for a change a bot makes.

## Decisions of stage 2 and 3

On 2026-10-06 the owner chose the outcome (groups 1 and the open question of group 2: "OK do it") and, on the prototype in the browser pane, the scope as written in [milestone8.md](../../product/milestone8.md).

## Uncertainties resolved at stage 4

All by reading the code at `57336cb` on 2026-10-06; nothing was run. One architecture decision is proposed: [ADR 013](../../adr/013-a-change-to-an-approved-job-waits-beside-it.md). None of the findings changes the agreed outcome; one changed the scope's wording before the owner's later look is needed.

- **Is there one call for "Approve all"?** No. Each app answers every waiting job with its own call of `POST /api/bots/:id/jobs/:jobId/approve` (`server.js`). The server cannot tell that tap from a yes on the card, so the rule lives in the apps, and an app from Milestone 7 keeps approving scripts until it is updated. The scope says so under Exclusions and C17.
- **Can a change wait beside a job?** Yes: `normalizeJob` (`lib/jobs.js`) decides in one place whether a change needs the owner (`changed`, `autoApproved`, `alwaysApprove`) and writes over the job; the scheduler reads `enabled && approved`. The approved definition has to be kept and the change stored beside it: ADR 013.
- **What does an older app see of a change?** It finds waiting jobs by `approved: false`, which a job with a change no longer has. Open in ADR 013, for SURE-002: the job runs on either way.
- **Why is a job's question quiet?** `split` (`lib/choices.js`) stores a questions-only reply with an empty result, and `quietRun` (`lib/problems.js`) reads an empty result of a scheduled run as nothing to report. One condition.
- **Where does "asks" come from?** The run keeps `choices` and `questions` (`lib/bots.js`); `runSummary` (`lib/events.js`) and `botStates` (`server.js`) leave them out. Both are one place each. When it ends is the owner's next message to that bot, which the server takes in one route.
- **Does a bot's own proposal fit the carry-on of ADR 009?** Yes: `carryOnAfter` (`lib/asks.js`) starts from the runs an ask keeps (`runs`). A job a bot adds, a tile it suggests and a change to its instructions keep none (`lib/self-mcp.js`). They need that link and nothing new.
- **The gates.** `MILESTONE_STAGES` is `tools-real`; `RESILIENCE_STAGES` is the Android build, tests and lint. No new stage is needed.
- **Not resolved, and where it is decided:** that a bot marks its question, and what it says when started again after its proposal, are model behaviour: the owner's checklist and C18.
